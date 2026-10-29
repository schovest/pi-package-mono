// 移植适配：上游 vitest.config env { COLORTERM: 'truecolor' } 移入此处（root vitest 不为单包加 env）。
process.env.COLORTERM ??= "truecolor";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import extension from "../src/index.ts";

export function loadRenderingExtension() {
  let resolver: ToolRendererResolver;
  extension({
    on: vi.fn(),
    registerTool: vi.fn(() => {
      throw new Error("Display extensions must not register tools");
    }),
    registerToolRenderer: vi.fn((value: ToolRendererResolver) => {
      resolver = value;
    }),
  } as any);
  return (name: string, id: string, args: any, original?: ToolRenderers) =>
    new ToolExecutionComponent(
      name,
      id,
      args,
      {},
      resolver(name, () => original),
      { requestRender() {} } as any,
      process.cwd(),
    );
}
