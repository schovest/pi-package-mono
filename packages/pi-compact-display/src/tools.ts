import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Config, resolveToolConfig } from "./config.ts";
import { GroupContent, getGroupOwner } from "./group.ts";
import { colorizeResult, formatCallLine, formatOutput, resolveResultText } from "./renderUtils.ts";
import { ZERO, wrapWithBox } from "./uiUtils.ts";

export function registerToolRenderers(pi: ExtensionAPI, config: Config) {
  pi.registerToolRenderer((toolName, next) => {
    const original = next();
    const baseConfig = resolveToolConfig(toolName, undefined, config);
    const hasOverrides = Object.keys(config).some((key) => key.startsWith(`${toolName}:`));
    if (baseConfig.mode === "default" && !hasOverrides) return original;

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const toolConfig = resolveToolConfig(toolName, args, config);
        const bold = typeof theme.bold === "function" ? theme.bold : (s: string) => s;
        const fallbackCall = () => new Text(theme.fg("toolTitle", bold(formatCallLine(toolName, args))), 0, 0);

        if (toolConfig.mode === "default") {
          return wrapWithBox(
            original?.renderCall?.(args, theme, context) ?? fallbackCall(),
            theme,
            context,
            toolConfig,
          );
        }
        if (toolConfig.mode === "count_only") return ZERO;
        const callBox = wrapWithBox(fallbackCall(), theme, context, toolConfig);
        if (config.grouping !== true || toolConfig.grouping === false) return callBox;
        let group: GroupContent | undefined;
        return {
          invalidate() {
            group?.invalidate();
            callBox.invalidate();
          },
          render(width) {
            const owner = getGroupOwner(context.state);
            if (!owner) return callBox.render(width);
            group ??= new GroupContent(owner, config, theme);
            return group.render(width);
          },
        };
      },
      renderResult(result, options, theme, context) {
        const toolConfig = resolveToolConfig(toolName, context.args, config);
        if (toolConfig.mode === "default") {
          if (original?.renderResult) {
            const rendered = original.renderResult(result, options, theme, context);
            return rendered ? wrapWithBox(rendered, theme, context, toolConfig) : ZERO;
          }
          const raw = resolveResultText(toolName, context.args, { ...result, isError: context.isError });
          if (!raw) return ZERO;
          return wrapWithBox(new Text(raw, 0, 0), theme, context, toolConfig);
        }
        const grouped = config.grouping === true && toolConfig.grouping !== false;
        if (
          toolConfig.mode === "count_only" ||
          options.isPartial ||
          (grouped && (!options.expanded || getGroupOwner(context.state)))
        )
          return ZERO;
        const raw = resolveResultText(toolName, context.args, { ...result, isError: context.isError });
        const formatted = formatOutput(raw, toolConfig, options.expanded);
        if (!formatted) return ZERO;
        const resultBox = wrapWithBox(
          new Text(colorizeResult(toolName, formatted, theme), 0, 0),
          theme,
          context,
          toolConfig,
        );
        if (!grouped) return resultBox;
        return {
          invalidate() {
            resultBox.invalidate();
          },
          render: (width) => (getGroupOwner(context.state) ? [] : resultBox.render(width)),
        };
      },
    };
  });
}
