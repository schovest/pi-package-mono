import os from "os";
import path from "path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  SkillInvocationMessageComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { isAssistantMessage, isSkillInvocation, isSpacer, isUserMessage } from "./componentUtils.ts";
import { getEffectiveToolName, loadConfig, resolveToolConfig } from "./config.ts";
import { cleanContextMessages } from "./contextUtils.ts";
import { resetChildren, trackChild, untrackChild } from "./group.ts";
import { SummaryTracker } from "./state.ts";
import { appendGroupWidget, isActive, setCapturedTheme } from "./thinkingGroup.ts";
import { registerToolRenderers } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  if (typeof pi.registerToolRenderer !== "function") {
    throw new Error("pi-compact-display requires Pi >=1.0.1 with registerToolRenderer(); please upgrade Pi.");
  }
  const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-compact-display", "config.json");
  const config = loadConfig(configPath);
  const tracker = new SummaryTracker();

  // ── Capture host theme for thinkingGrouping labels ──
  // thinkingGroup.ts の自描画ラベルはホストテーマ (fg / italic) を必要とする。message_start は
  // 毎ターン・コンポーネント生成前に発火するためここで捕捉して渡す (捕獲後の次フレームで
  // 自動再スタイル)。headless など ctx.ui.theme が無い場合は何もしない (無色降格は同モジュール側)。
  pi.on("message_start", async (_event, ctx) => {
    const theme = (ctx as any)?.ui?.theme;
    if (theme) setCapturedTheme(theme);
  });

  // @ts-ignore
  const originalRebuild = UserMessageComponent.prototype.rebuild;
  // @ts-ignore
  UserMessageComponent.prototype.rebuild = function () {
    originalRebuild.call(this);
    if (config.user?.noPadding) {
      const box = (this as any).children?.[0];
      if (box) {
        box.paddingY = 0;
        if (typeof box.invalidate === "function") {
          box.invalidate();
        }
      }
    }
  };

  // ── Hide thinking blocks (issue #2) ──
  // AssistantMessageComponent.updateContent をパッチして、config.hideThinking が true の場合に
  // thinking コンテンツブロックを message.content から除去してからオリジナルの処理に渡す。
  // これにより Pi の hideThinkingBlock 設定 (キーバインド toggle) の状態に関わらず
  // thinking ブロックの表示を完全に抑制できる。
  //
  // 三分岐 (thinkingGrouping 拡張):
  //   ① isActive (hideThinking + thinkingGrouping 両 true): thinking 除去前に元メッセージを
  //      __piCompactOriginalMessage に退避し、描画後に領隊へ折りたたみウィジェットを挿入する。
  //      ホストの再描画経路 (invalidate / setHiddenThinkingLabel / setHideThinkingBlock /
  //      setOutputPad) は thinking 除去済みの lastMessage で呼び直すため、その場合は退避した
  //      元メッセージを実効メッセージとして使い同じ絵 (ウィジェット含む) を作り直す。
  //      appendGroupWidget は冪等 (再挿入前に自ブロックを撤去) なので、ネストしたパッチ
  //      (拡張ファクトリの同プロセス再実行、例: pi-subagents 子 session の ambient 再ロード)
  //      で多重に呼ばれてもリーダーには 1 ブロックしか残らない (生成直後の未 track は no-op、
  //      リプレイは customAddChild 側の追い挿入で補う)。
  //   ② hideThinking のみ: 従来の純粋隠蔽 (上記の動作)。
  //   ③ それ以外: 素通し。
  // @ts-ignore
  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent;
  // @ts-ignore
  AssistantMessageComponent.prototype.updateContent = function (message: any) {
    if (isActive(config)) {
      const hasThinking = (m: any) => Array.isArray(m?.content) && m.content.some((c: any) => c?.type === "thinking");
      // 実効メッセージ: 呼び出し側のメッセージに thinking があればそれを、なければ (ホスト再描画
      // が渡す除去済み lastMessage の場合) 退避した元メッセージを優先する。退避 ref は
      // 同一のまま再設定されるため冪等 (除去済みメッセージで退避が上書きされることはない)。
      const stash = (this as any).__piCompactOriginalMessage;
      const effective = hasThinking(message) ? message : hasThinking(stash) ? stash : message;
      const content = Array.isArray(effective?.content) ? effective.content : [];
      const effectiveHasThinking = content.some((c: any) => c?.type === "thinking");
      if (effectiveHasThinking) (this as any).__piCompactOriginalMessage = effective;
      const target = effectiveHasThinking
        ? { ...effective, content: content.filter((c: any) => c.type !== "thinking") }
        : effective;
      const result = originalUpdateContent.call(this, target);
      if (effectiveHasThinking) appendGroupWidget(this);
      return result;
    }
    if (config.hideThinking) {
      const filtered = {
        ...message,
        content: message.content.filter((c: any) => c.type !== "thinking"),
      };
      return originalUpdateContent.call(this, filtered);
    }
    return originalUpdateContent.call(this, message);
  };

  // ── Skill invocation padding (issue #3) ──
  // SkillInvocationMessageComponent は Box を継承し、コンストラクタで super(1, 1, ...) を
  // 呼ぶためデフォルトで paddingY = 1 (上下1行ずつの空行) が付く。updateDisplay は
  // コンストラクタ・setExpanded・invalidate から呼ばれるため、ここで paddingY を
  // 書き換えれば全ての経路でパディングを除去できる。
  // @ts-ignore
  const originalSkillUpdateDisplay = SkillInvocationMessageComponent.prototype.updateDisplay;
  // @ts-ignore
  SkillInvocationMessageComponent.prototype.updateDisplay = function () {
    originalSkillUpdateDisplay.call(this);
    if (config.skill?.noPadding) {
      // @ts-ignore
      this.paddingY = 0;
    }
  };

  let lastAddedSpacer: any = null;
  let lastSignificantComponentType: string | null = null;

  // Retrieve Container prototype from AssistantMessageComponent to be loader-agnostic
  const containerProto = Object.getPrototypeOf(AssistantMessageComponent.prototype) || Container.prototype;

  // @ts-ignore
  const originalAddChild = containerProto.addChild;
  // @ts-ignore
  const originalAddChildTui = Container.prototype.addChild;

  const hasProto = (obj: any, proto: any) => {
    let p = Object.getPrototypeOf(obj);
    while (p) {
      if (p === proto) return true;
      p = Object.getPrototypeOf(p);
    }
    return false;
  };

  const customAddChild = function (this: any, comp: any) {
    const userNoPad = config.user?.noPadding;
    const skillNoPad = config.skill?.noPadding;

    if (userNoPad || skillNoPad) {
      if (isSpacer(comp)) {
        lastAddedSpacer = comp;
        if (
          (lastSignificantComponentType === "user" && userNoPad) ||
          (lastSignificantComponentType === "skill" && skillNoPad)
        ) {
          comp.lines = 0;
        }
      } else if (isUserMessage(comp)) {
        if (userNoPad && lastAddedSpacer) {
          lastAddedSpacer.lines = 0;
        }
        lastSignificantComponentType = "user";
        lastAddedSpacer = null;
      } else if (isSkillInvocation(comp)) {
        if (skillNoPad && lastAddedSpacer) {
          lastAddedSpacer.lines = 0;
        }
        lastSignificantComponentType = "skill";
        lastAddedSpacer = null;
      } else if (isAssistantMessage(comp)) {
        lastSignificantComponentType = "assistant";
        lastAddedSpacer = null;
      }
    }

    // ミラーの二重登録防止: ネストしたパッチ (二重ロード時) では外側だけが trackChild する
    const alreadyTracked = (comp as any).__piCompactTrackedBy === this;
    (comp as any).__piCompactTrackedBy = this;

    // originalAddChild が例外を投げても、トラッキング状態がコンポーネントに残留 (リーク) しないよう
    // try/finally で保護する。trackChild は addChild が成功した場合のみ実行する。
    try {
      if (originalAddChildTui !== originalAddChild) {
        if (hasProto(this, Container.prototype)) {
          originalAddChildTui.call(this, comp);
        } else {
          originalAddChild.call(this, comp);
        }
      } else {
        originalAddChild.call(this, comp);
      }

      if (!alreadyTracked) {
        trackChild(this, comp);
      }
    } finally {
      // ネストしたパッチ (外側が trackChild する) の場合も最終状態は undefined で良い
      // (外側の finally でも同様にクリアされる)。
      (comp as any).__piCompactTrackedBy = undefined;
    }

    // リプレイ経路の追い挿入: ホストは AssistantMessageComponent を「コンストラクタ内 updateContent
    // (ミラー未登録 = 挿入 no-op) → addChild」の順で配置し、その後 updateContent を呼ばない。
    // そのためミラー登録直後 (trackChild 成功後) にここで挿入する。ネストしたパッチでは内側の
    // 呼び出しはまだ trackChild されていないため no-op になり、外側の 1 回だけが挿入する。
    // ライブ経路はこの後の updateContent が contentContainer を clear して作り直すため
    // 二重挿入にはならない (毎回 1 個)。
    if (isActive(config) && isAssistantMessage(comp)) {
      appendGroupWidget(comp);
    }

    if (userNoPad || skillNoPad) {
      if (isAssistantMessage(comp)) {
        lastSignificantComponentType = "assistant";
      }
    }
  };

  // @ts-ignore
  containerProto.addChild = customAddChild;
  if (Container.prototype !== containerProto) {
    // @ts-ignore
    Container.prototype.addChild = customAddChild;
  }

  // 親子ミラー保守: removeChild / clear もパッチする (Box は別クラスなので無関係)
  // @ts-ignore
  const originalRemoveChild = Container.prototype.removeChild;
  // @ts-ignore
  Container.prototype.removeChild = function (this: any, comp: any) {
    originalRemoveChild.call(this, comp);
    untrackChild(this, comp);
  };

  // @ts-ignore
  const originalClear = Container.prototype.clear;
  // @ts-ignore
  Container.prototype.clear = function (this: any) {
    originalClear.call(this);
    resetChildren(this);
  };

  // ── Count tool calls for count_only tools ──
  pi.on("tool_call", async (event) => {
    const args = (event as any).input;
    const toolConfig = resolveToolConfig(event.toolName, args, config);
    if (toolConfig.mode === "count_only") {
      const displayName = getEffectiveToolName(event.toolName, args);
      tracker.countCall(event.toolCallId, displayName);
    }
  });

  // ── Detect errors in count_only tools ──
  pi.on("tool_result", async (event) => {
    const args = (event as any).input;
    const toolConfig = resolveToolConfig(event.toolName, args, config);
    if (toolConfig.mode === "count_only" && event.isError) {
      tracker.setError();
    }
  });

  // ── Prepend summary to assistant's text response ──
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (!tracker.hasGrouped()) return;

    // ターン中: ツール要求メッセージ (stopReason "toolUse") では集計を保持する。
    // Pi は1ターン内で複数の message_end を発火する (toolUse → ツール実行 → 最終応答) ため、
    // ここでリセットすると同一ターン内の後続ツールが集計漏れする (a21efc7 の I3 対応)。
    const stopReason = (event.message as any).stopReason;
    if (stopReason === "toolUse") return;

    const content = event.message.content;
    if (!Array.isArray(content)) return;

    const hasText = content.some((b: any) => b.type === "text");

    // 正常系終端 (stopReason "stop" かつテキストあり): サマリーを注入し、注入後にリセットする。
    if (stopReason === "stop" && hasText) {
      const summary = tracker.getSummaryLine();
      const hasErrors = tracker.hasErrors();
      tracker.reset();

      const theme = ctx?.ui?.theme;
      const styledSummary = theme ? theme.bg(hasErrors ? "toolErrorBg" : "toolSuccessBg", ` ${summary} `) : summary;

      const newContent = content.map((b: any) => {
        if (b.type === "text") {
          return { ...b, text: `${styledSummary}\n${b.text}` };
        }
        return b;
      });

      return { message: { ...event.message, content: newContent } };
    }

    // 異常系終端 (stopReason "error" / "aborted" / "length" / undefined) または
    // テキストなし終端: サマリーは注入できないがターンは終了している。
    // 前ターンのカウントとエラーフラグを次ターンへリークさせないため必ずリセットする (I1)。
    tracker.reset();
    return;
  });

  // ── Strip summary before sending to LLM ──
  pi.on("context", async (event) => {
    const cleaned = cleanContextMessages(event.messages);
    return { messages: cleaned };
  });

  registerToolRenderers(pi, config);
}
