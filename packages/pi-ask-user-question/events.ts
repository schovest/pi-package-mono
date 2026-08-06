/**
 * Public event contract for @schovest/pi-ask-user-question.
 *
 * STABILITY POLICY — applies to every event in the `rpiv:*` namespace.
 *
 *   1. Channel names are immutable. Once shipped, never rename.
 *   2. Payload changes are append-only. Listeners MUST tolerate unknown
 *      fields. New fields ship as optional (`?:`).
 *   3. Breaking changes (rename, retype, remove a field; change emission
 *      semantics) require a NEW channel, e.g. `rpiv:ask-user:prompt.v2`,
 *      with dual-emit during a deprecation window.
 *   4. No `version` field inside payloads. Version via channel name only.
 *   5. Payloads must be JSON-safe: primitives, arrays, plain objects.
 *      No Set/Map/Date/class instances — payloads must survive JSON
 *      serialization when listeners forward them across process or
 *      network boundaries.
 *
 * Naming: `rpiv:<package-or-tool>:<phase>`, lowercase, hyphen-separated.
 * Aligns with Pi's `"my-extension:status"` example and UniPi's `unipi:*`.
 */

export const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt" as const;

export interface AskUserPromptEventPayload {
  questions: ReadonlyArray<AskUserPromptQuestion>;
}

/**
 * Emitted while the questionnaire is awaiting user input (TUI `ui.custom` and
 * RPC dialog walker). Cleared with `{ active: false }` in `finally` so listeners
 * can distinguish blocked-on-human from working.
 */
export const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked" as const;

export interface AskUserBlockedEventPayload {
  /** True while input is awaited; false when the wait ends (answer, cancel, or error). */
  active: boolean;
}

/**
 * Emitted once when the user aborts the questionnaire with Esc (TUI) or by
 * dismissing a dialog (RPC walker) — the questionnaire closes with
 * `cancelled: true` exactly as before; this event only notifies external
 * listeners (e.g. status/notification plugins) that the abort happened.
 * Not emitted for validation errors or hosts that never showed the questions.
 */
export const ASK_USER_ABORTED_EVENT = "rpiv:ask-user:aborted" as const;

export interface AskUserAbortedEventPayload {
  /** Always true — present so listeners can discriminate the event from future append-only fields. */
  aborted: true;
}

export interface AskUserPromptQuestion {
  /** The full question text, exactly as the agent authored it. */
  question: string;
  /** The short chip/tag shown next to the question. */
  header: string;
  /** True iff the user may pick multiple options. Normalized from optional. */
  multiSelect: boolean;
  options: ReadonlyArray<AskUserPromptOption>;
}

export interface AskUserPromptOption {
  label: string;
  description: string;
  /** True iff the option carries rich preview content (content not shipped). */
  hasPreview: boolean;
}
