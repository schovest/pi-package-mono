/**
 * 最小 rpiv-workflow 类型 stub（上游 test-utils 从 @juicesharp/rpiv-workflow
 * 类型导入 ModelSelection / WorkflowHostContext / WorkflowSessionContext；
 * rpiv-workflow 不在移植范围，这里仅提供结构兼容的本地类型，
 * 供测试夹具在 `as unknown as` 断言与选项类型中使用）。
 */

export interface ModelSelection {
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface WorkflowHostContext {
  cwd: string;
  hasUI: boolean;
  ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
  sessionManager: {
    getBranch(): unknown;
    getSessionId(): string;
    getSessionFile(): string | undefined;
  };
  waitForIdle(): Promise<void>;
  signal?: AbortSignal;
  readonly maxConcurrency: number;
  spawnChild<T>(options: {
    prompt: string;
    model?: ModelSelection;
    signal?: AbortSignal;
    reattach?: { sessionFile: string };
    fork?: { sessionFile: string };
    unitIndex?: number;
    withSession: (child: WorkflowSessionContext) => Promise<T>;
  }): Promise<T>;
}

export interface WorkflowSessionContext extends WorkflowHostContext {
  sendUserMessage(content: string): Promise<void>;
}
