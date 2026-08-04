/**
 * i18n-ui — bordered select-panel for the /languages command.
 *
 * Mirrors advisor-ui.ts:showAdvisorPicker — bordered container with title,
 * prose, SelectList, nav hint. Single public function (showLanguagePicker);
 * private buildSelectPanel owns the layout + theme wiring.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

const MAX_VISIBLE_ROWS = 10;
const NAV_HINT = "↑↓ navigate • enter select • esc cancel";

const HEADER_TITLE = "UI Language";
const HEADER_PROSE =
  "Choose the locale used for rpiv-* TUI strings (sentinel rows, hints, " +
  "submit labels, preview text). LLM-facing copy stays English. Selection " +
  "persists at ~/.config/rpiv-i18n/locale.json.";

function selectListTheme(theme: Theme) {
  return {
    selectedPrefix: (t: string) => theme.bg("selectedBg", theme.fg("accent", t)),
    selectedText: (t: string) => theme.bg("selectedBg", theme.bold(t)),
    description: (t: string) => theme.fg("muted", t),
    scrollInfo: (t: string) => theme.fg("dim", t),
    noMatch: (t: string) => theme.fg("warning", t),
  };
}

function buildSelectPanel(theme: Theme, title: string, proseLines: string[], selectList: SelectList): Container {
  const container = new Container();
  const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));

  container.addChild(border());
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  container.addChild(new Spacer(1));
  for (const line of proseLines) {
    container.addChild(new Text(line, 1, 0));
    container.addChild(new Spacer(1));
  }
  container.addChild(selectList);
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("dim", NAV_HINT), 1, 0));
  container.addChild(new Spacer(1));
  container.addChild(border());
  return container;
}

export async function showLanguagePicker(ctx: ExtensionContext, items: SelectItem[]): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const selectList = new SelectList(items, Math.min(items.length, MAX_VISIBLE_ROWS), selectListTheme(theme));
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    const container = buildSelectPanel(theme, HEADER_TITLE, [HEADER_PROSE], selectList);

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
