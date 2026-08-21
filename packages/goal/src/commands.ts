import { currentTokenTotal, formatTokenCount } from "./accounting.js";
import { validateObjective } from "./command.js";
import { notifyTerminal, safeGoalMenuText } from "./errors.js";
import type { ActiveGoal } from "./persistence.js";
import {
  buildGoalPrompt,
  buildObjectiveUpdatedPrompt,
  buildResumePrompt,
  buildWaitingResumePrompt,
} from "./prompts.js";
import {
  type GoalRuntime,
  STATUS_KEY,
  type StatusContext,
  blocksStaleGoalToolCalls,
  createGoal,
  editedGoalStatus,
  formatBudget,
  formatError,
  goalSummary,
  isResumableGoalStatus,
  nextGoalInstance,
  queueGoalSafetyReset,
  stoppedStatusLabel,
  transitionGoal,
} from "./runtime.js";

// User-command mutations are kept separate from Pi event wiring. Every controller
// receives exactly one per-factory GoalRuntime, preserving session isolation.
export class GoalCommandController {
  private readonly runtime: GoalRuntime;

  constructor(runtime: GoalRuntime) {
    this.runtime = runtime;
  }

  async startGoal(
    objective: string,
    tokenBudget: number | undefined,
    ctx: StatusContext,
    onActivated?: (goal: ActiveGoal) => void,
    isActivationCurrent?: (goal: ActiveGoal) => boolean,
    isRequestCurrent?: () => boolean,
  ) {
    if (isRequestCurrent && !isRequestCurrent()) return;
    const validationError = validateObjective(objective);
    if (validationError) {
      notifyTerminal(ctx.ui, validationError, "warning");
      return;
    }

    const existingGoal = this.runtime.activeGoal?.status !== "complete" ? this.runtime.activeGoal : undefined;
    const legacyQueueBeforeActivation = existingGoal
      ? undefined
      : this.runtime.legacyQueueState
        ? structuredClone(this.runtime.legacyQueueState)
        : undefined;
    if (existingGoal) {
      const shouldReplace = await ctx.ui.confirm(
        "Replace goal?",
        `Current goal: ${safeGoalMenuText(existingGoal.text, 4_000)}\n\nNew goal: ${safeGoalMenuText(objective, 4_000)}`,
      );
      if (!shouldReplace) {
        notifyTerminal(ctx.ui, `Goal kept: ${existingGoal.text}`, "info");
        return;
      }
      if (isRequestCurrent && !isRequestCurrent()) return;
      if (this.runtime.activeGoal?.id !== existingGoal.id) {
        notifyTerminal(ctx.ui, "The active goal changed while confirmation was open. Try again.", "warning");
        return;
      }
    }

    // Unlock lazy visibility only for a real activation. In always mode, a
    // missing tool means another policy or allowlist intentionally removed it.
    if (isRequestCurrent && !isRequestCurrent()) return;
    const goalToolVisibilityBeforeActivation = this.runtime.toolPolicy.snapshot();
    try {
      this.runtime.toolPolicy.prepareActivation(this.runtime.settings.toolVisibility, ctx);
    } catch (error) {
      notifyTerminal(ctx.ui, `Cannot start /goal: ${formatError(error)}`, "error");
      if (existingGoal?.status === "active") this.runtime.pauseGoalForUnavailableTools(ctx);
      return;
    }

    this.runtime.clearGoalWaitTimer();
    this.runtime.cancelContinuationWork();
    this.runtime.clearGoalRecovery();
    this.runtime.clearBudgetWrapUp();
    this.runtime.clearStaleGoalToolCallBlock();
    if (!legacyQueueBeforeActivation) this.runtime.legacyQueueState = undefined;
    this.runtime.activeGoal = createGoal(objective, tokenBudget, currentTokenTotal(ctx));
    const startedGoal = this.runtime.activeGoal;
    onActivated?.(startedGoal);
    if (!legacyQueueBeforeActivation) this.runtime.persistGoal(startedGoal);
    if (this.runtime.activeGoal?.id !== startedGoal.id || this.runtime.activeGoal.status !== "active") {
      return;
    }
    this.runtime.updateStatus(ctx, startedGoal);
    const sent = await this.runtime.sendOwnedGoalPrompt(
      ctx,
      startedGoal.id,
      buildGoalPrompt(startedGoal),
      true,
      () => (isRequestCurrent?.() ?? true) && (isActivationCurrent?.(startedGoal) ?? true),
    );
    if (
      sent &&
      legacyQueueBeforeActivation &&
      this.runtime.activeGoal?.id === startedGoal.id &&
      this.runtime.activeGoal.status === "active"
    ) {
      this.runtime.legacyQueueState = undefined;
      this.runtime.persistGoal(startedGoal);
    }
    if (isActivationCurrent && !isActivationCurrent(startedGoal)) return;
    if (!sent) {
      let rolledBackStartedGoal = false;
      if (this.runtime.activeGoal?.id === startedGoal.id) {
        rolledBackStartedGoal = true;
        if (existingGoal) {
          this.runtime.recordGoalUsage(existingGoal, ctx);
          if (existingGoal.status === "active" && existingGoal.waiting) {
            this.runtime.activeGoal = existingGoal;
            this.runtime.clearStaleGoalToolCallBlock();
            this.runtime.persistGoal(existingGoal);
            this.runtime.updateStatus(ctx, existingGoal);
            this.runtime.restoreGoalWaitTimer(ctx);
          } else if (existingGoal.status === "active") {
            this.runtime.stopActiveGoal(ctx, {
              kind: "activation_rollback",
              expectedGoalId: startedGoal.id,
              restoreGoal: existingGoal,
              abortTurn: true,
            });
          } else {
            this.runtime.activeGoal = existingGoal;
            if (blocksStaleGoalToolCalls(this.runtime.activeGoal.status)) {
              this.runtime.blockStaleGoalToolCalls();
            } else {
              this.runtime.clearStaleGoalToolCallBlock();
            }
            this.runtime.persistGoal(this.runtime.activeGoal);
            this.runtime.updateStatus(ctx, this.runtime.activeGoal);
          }
        } else if (legacyQueueBeforeActivation) {
          this.runtime.activeGoal = undefined;
          this.runtime.legacyQueueState = legacyQueueBeforeActivation;
          this.runtime.cancelContinuationWork();
          this.runtime.clearGoalRecovery();
          this.runtime.clearBudgetWrapUp();
          this.runtime.clearStaleGoalToolCallBlock();
          ctx.ui.setStatus(STATUS_KEY, undefined);
        } else {
          this.runtime.clearActiveGoal(ctx);
        }
      }
      if (rolledBackStartedGoal) {
        this.runtime.toolPolicy.restore(goalToolVisibilityBeforeActivation);
      }
      return;
    }
    if (this.runtime.activeGoal?.id !== startedGoal.id || this.runtime.activeGoal.status !== "active") {
      return;
    }
    const automaticLimit = this.runtime.settings.continuationLimits.automaticTurns;
    notifyTerminal(
      ctx.ui,
      `${existingGoal ? "Goal replaced" : "Goal started"}: ${objective}. ${
        startedGoal.tokenBudget === undefined
          ? ""
          : `Token budget: ${formatTokenCount(startedGoal.tokenBudget)} cumulative; the final model call may exceed it. `
      }${
        automaticLimit === null
          ? "Automatic work is Unlimited; tool loops may consume substantial tokens and provider cost. Open /goal to monitor."
          : `Automatic work pauses after ${automaticLimit} responses; open /goal to monitor progress.`
      }`,
      automaticLimit === null ? "warning" : "info",
    );
  }

  pauseGoal(ctx: StatusContext) {
    if (!this.runtime.activeGoal) {
      notifyTerminal(ctx.ui, "No active goal.", "info");
      return;
    }
    if (this.runtime.activeGoal.status !== "active") {
      notifyTerminal(ctx.ui, `Goal is ${this.runtime.activeGoal.status}; only active goals can be paused.`, "warning");
      return;
    }
    const stoppedGoal = this.runtime.stopActiveGoal(ctx, {
      kind: "explicit_pause",
      expectedGoalId: this.runtime.activeGoal.id,
    });
    if (stoppedGoal) notifyTerminal(ctx.ui, `Goal paused: ${stoppedGoal.text}`, "info");
  }

  async resumeGoal(ctx: StatusContext) {
    if (!this.runtime.activeGoal) {
      notifyTerminal(ctx.ui, "No active goal.", "info");
      return;
    }
    if (this.runtime.activeGoal.status === "active" && this.runtime.activeGoal.waiting) {
      await this.resumeWaitingGoal(ctx);
      return;
    }
    if (!isResumableGoalStatus(this.runtime.activeGoal.status)) {
      notifyTerminal(
        ctx.ui,
        `Goal is ${this.runtime.activeGoal.status}; only paused, blocked, usage-limited, or budget-limited goals can be resumed.`,
        "warning",
      );
      return;
    }
    if (
      this.runtime.activeGoal.tokenBudget !== undefined &&
      this.runtime.activeGoal.tokensUsed >= this.runtime.activeGoal.tokenBudget
    ) {
      notifyTerminal(ctx.ui, `Goal token budget is still reached: ${formatBudget(this.runtime.activeGoal)}`, "warning");
      return;
    }
    const goalToolVisibilityBeforeActivation = this.runtime.toolPolicy.snapshot();
    try {
      this.runtime.toolPolicy.prepareActivation(this.runtime.settings.toolVisibility, ctx);
    } catch (error) {
      notifyTerminal(ctx.ui, `Cannot resume /goal: ${formatError(error)}`, "error");
      return;
    }
    const stoppedGoal = this.runtime.activeGoal;
    const stoppedStatus = stoppedGoal.status;
    this.runtime.cancelContinuationWork();
    this.runtime.clearGoalRecovery();
    this.runtime.clearBudgetWrapUp();
    this.runtime.clearStaleGoalToolCallBlock();
    this.runtime.activeGoal = queueGoalSafetyReset(transitionGoal(nextGoalInstance(this.runtime.activeGoal), "active"));
    this.runtime.persistGoal(this.runtime.activeGoal);
    this.runtime.updateStatus(ctx, this.runtime.activeGoal);
    if (this.runtime.activeGoal.status !== "active") {
      notifyTerminal(ctx.ui, `Goal token budget is still reached: ${formatBudget(this.runtime.activeGoal)}`, "warning");
      return;
    }
    const resumedGoal = this.runtime.activeGoal;
    const sent = await this.runtime.sendOwnedGoalPrompt(
      ctx,
      resumedGoal.id,
      buildResumePrompt(resumedGoal, stoppedStatus),
    );
    if (!sent) {
      if (this.runtime.activeGoal?.id === resumedGoal.id && this.runtime.activeGoal.status === "active") {
        this.runtime.activeGoal = stoppedGoal;
        this.runtime.persistGoal(this.runtime.activeGoal);
        this.runtime.updateStatus(ctx, this.runtime.activeGoal);
        if (blocksStaleGoalToolCalls(this.runtime.activeGoal.status)) {
          this.runtime.blockStaleGoalToolCalls();
        }
        this.runtime.toolPolicy.restore(goalToolVisibilityBeforeActivation);
      }
      return;
    }
    const automaticLimit = this.runtime.settings.continuationLimits.automaticTurns;
    notifyTerminal(
      ctx.ui,
      `Goal resumed from ${stoppedStatusLabel(stoppedStatus)}: ${resumedGoal.text}. ${
        automaticLimit === null
          ? "Automatic work remains Unlimited; goal progress and cumulative usage are preserved."
          : `The automatic-work counter will reset to 0 of ${automaticLimit} when the resumed prompt starts; goal progress and cumulative usage are preserved.`
      }`,
      automaticLimit === null ? "warning" : "info",
    );
  }

  private async resumeWaitingGoal(ctx: StatusContext) {
    const waitingGoal = this.runtime.activeGoal;
    const waiting = waitingGoal?.waiting;
    if (waitingGoal?.status !== "active" || !waiting) return;
    try {
      this.runtime.toolPolicy.prepareActivation(this.runtime.settings.toolVisibility, ctx);
    } catch (error) {
      notifyTerminal(ctx.ui, `Cannot resume /goal: ${formatError(error)}`, "error");
      return;
    }
    if (!this.runtime.clearGoalWait(ctx, waitingGoal.id)) return;
    const resumedGoal = this.runtime.activeGoal;
    if (!resumedGoal || resumedGoal.id !== waitingGoal.id || resumedGoal.status !== "active") return;
    const sent = await this.runtime.sendOwnedGoalPrompt(
      ctx,
      resumedGoal.id,
      buildWaitingResumePrompt(resumedGoal, waiting.reason),
      false,
    );
    if (!sent) {
      if (this.runtime.activeGoal?.id === waitingGoal.id) {
        this.runtime.enterGoalWait(ctx, waitingGoal.id, waiting);
      }
      return;
    }
    notifyTerminal(ctx.ui, `Goal resumed from waiting: ${waitingGoal.text}`, "info");
  }

  clearGoal(ctx: StatusContext) {
    if (!this.runtime.activeGoal) {
      const hadLegacyQueue = this.runtime.legacyQueueState !== undefined;
      this.runtime.legacyQueueState = undefined;
      this.runtime.cancelContinuationWork();
      this.runtime.clearGoalRecovery();
      this.runtime.clearBudgetWrapUp();
      this.runtime.clearStaleGoalToolCallBlock();
      this.runtime.clearPersistedGoal(ctx.cwd);
      ctx.ui.setStatus(STATUS_KEY, undefined);
      notifyTerminal(
        ctx.ui,
        hadLegacyQueue ? "Removed legacy ordered goal queue state." : "No active goal.",
        hadLegacyQueue ? "warning" : "info",
      );
      return;
    }

    const stoppedGoal = this.runtime.activeGoal.text;
    this.runtime.clearActiveGoal(ctx);
    notifyTerminal(ctx.ui, `Goal cleared: ${stoppedGoal}`, "warning");
  }

  async editGoal(objective: string, tokenBudget: number | undefined, ctx: StatusContext) {
    const validationError = validateObjective(objective);
    if (validationError) {
      notifyTerminal(ctx.ui, validationError, "warning");
      return;
    }
    if (!this.runtime.activeGoal) {
      notifyTerminal(ctx.ui, "No active goal. Use /goal <objective> to start one.", "warning");
      return;
    }

    this.runtime.recordGoalUsage(this.runtime.activeGoal, ctx);
    const previousGoal = { ...this.runtime.activeGoal };
    this.runtime.clearGoalWaitTimer();
    this.runtime.cancelContinuationWork();
    this.runtime.clearGoalRecovery();
    this.runtime.clearBudgetWrapUp();
    const previousStatus = this.runtime.activeGoal.status;
    const rotatedGoal = nextGoalInstance(this.runtime.activeGoal);
    const transitionedGoal = transitionGoal(
      {
        ...rotatedGoal,
        text: objective,
        tokenBudget: tokenBudget ?? this.runtime.activeGoal.tokenBudget,
        waiting: undefined,
      },
      editedGoalStatus(previousStatus),
    );
    const nextGoal = transitionedGoal.status === "active" ? queueGoalSafetyReset(transitionedGoal) : transitionedGoal;
    const goalToolVisibilityBeforeActivation =
      nextGoal.status === "active" ? this.runtime.toolPolicy.snapshot() : undefined;
    if (nextGoal.status === "active") {
      try {
        this.runtime.toolPolicy.prepareActivation(this.runtime.settings.toolVisibility, ctx);
      } catch (error) {
        notifyTerminal(ctx.ui, `Cannot reactivate /goal: ${formatError(error)}`, "error");
        if (this.runtime.activeGoal?.status === "active") {
          this.runtime.pauseGoalForUnavailableTools(ctx);
        }
        return;
      }
    }
    this.runtime.activeGoal = nextGoal;
    this.runtime.persistGoal(this.runtime.activeGoal);
    this.runtime.updateStatus(ctx, this.runtime.activeGoal);
    const editedGoal = this.runtime.activeGoal;
    if (!editedGoal) return;
    if (editedGoal.status === "active") {
      this.runtime.clearStaleGoalToolCallBlock();
      const sent = await this.runtime.sendOwnedGoalPrompt(ctx, editedGoal.id, buildObjectiveUpdatedPrompt(editedGoal));
      if (!sent) {
        if (this.runtime.activeGoal?.id === editedGoal.id) {
          if (previousStatus === "active" && previousGoal.waiting) {
            this.runtime.activeGoal = previousGoal;
            this.runtime.clearStaleGoalToolCallBlock();
            this.runtime.persistGoal(previousGoal);
            this.runtime.updateStatus(ctx, previousGoal);
            this.runtime.restoreGoalWaitTimer(ctx);
          } else if (previousStatus === "active") {
            this.runtime.stopActiveGoal(ctx, {
              kind: "activation_rollback",
              expectedGoalId: editedGoal.id,
              restoreGoal: previousGoal,
              abortTurn: true,
            });
          } else {
            this.runtime.activeGoal = previousGoal;
            if (blocksStaleGoalToolCalls(this.runtime.activeGoal.status)) {
              this.runtime.blockStaleGoalToolCalls();
            } else {
              this.runtime.clearStaleGoalToolCallBlock();
            }
            this.runtime.persistGoal(this.runtime.activeGoal);
            this.runtime.updateStatus(ctx, this.runtime.activeGoal);
          }
          if (goalToolVisibilityBeforeActivation) {
            this.runtime.toolPolicy.restore(goalToolVisibilityBeforeActivation);
          }
        }
        return;
      }
    } else if (blocksStaleGoalToolCalls(editedGoal.status)) {
      this.runtime.blockStaleGoalToolCalls();
    } else {
      this.runtime.clearStaleGoalToolCallBlock();
    }
    notifyTerminal(ctx.ui, `Goal updated: ${objective}`, "info");
  }

  showGoal(ctx: StatusContext) {
    if (!this.runtime.activeGoal) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      this.reportGoalStatus(ctx, this.emptyGoalMessage());
      return;
    }
    this.runtime.recordGoalUsage(this.runtime.activeGoal, ctx);
    this.runtime.persistGoal(this.runtime.activeGoal);
    this.runtime.updateStatus(ctx, this.runtime.activeGoal);
    this.reportGoalStatus(
      ctx,
      goalSummary(this.runtime.activeGoal, this.runtime.settings.continuationLimits.automaticTurns),
    );
  }

  private emptyGoalMessage() {
    const legacy = this.runtime.legacyQueueState;
    if (!legacy) return "Usage: /goal <objective>\nNo goal is currently set.";
    return [
      "Ordered goal queue has been removed.",
      `Legacy queue state with ${legacy.retainedGoals} retained ${legacy.retainedGoals === 1 ? "goal" : "goals"} will not run automatically.`,
      "Use /goal edit to reprioritize an active objective, start /goal <objectives>, or use /goal clear to discard the old queue state.",
      'Example objective: "task b is complete; do task a next, then task c and task d."',
    ].join("\n");
  }

  private reportGoalStatus(ctx: StatusContext, message: string) {
    if (ctx.mode === "print" || ctx.mode === "json") {
      throw new Error(
        `/goal status is unavailable in ${ctx.mode} mode because Pi does not expose an extension-command output channel. Use TUI or RPC mode.`,
      );
    }
    notifyTerminal(ctx.ui, message, "info");
  }
}
