import { Box } from "@earendil-works/pi-tui";
import type { ToolConfig } from "./config.ts";

export class ZeroHeight {
  render(_width: number): string[] {
    return [];
  }
  invalidate(): void {}
}

export const ZERO = new ZeroHeight();

export function wrapWithBox(component: any, theme: any, context: any, config?: ToolConfig) {
  if (component === ZERO) return ZERO;
  const bgName = context?.isPartial ? "toolPendingBg" : context?.isError ? "toolErrorBg" : "toolSuccessBg";
  const padTop = config?.noPadding ? 0 : 1;
  const box = new Box(padTop, 0, (text: string) => theme.bg(bgName, text));
  box.addChild(component);
  return box;
}
