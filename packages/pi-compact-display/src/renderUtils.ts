import { renderDiff } from "@earendil-works/pi-coding-agent";
import { getEffectiveToolName, ToolConfig } from './config.ts';
import { sanitizeToolText } from './sanitize.ts';

export function formatOutput(input: string, config: ToolConfig, expanded: boolean): string {
  // ツール出力はホストの getTextOutput と同じ意味論 (stripAnsi + 制御文字除去 + CR 除去) で
  // 無害化してから整形する。グループカード展開時と拡張 default ルートがホストの
  // サニタイザを迂回して ANSI/OSC-8 バイトが端末に届かないようにするため。
  let lines = sanitizeToolText(input).split('\n');

  if (config.noPadding) {
    lines = lines.filter(line => line.trim() !== '');
  }

  if (!expanded && config.outputLines !== undefined) {
    lines = lines.slice(0, config.outputLines);
  }

  return lines.join('\n');
}

/** 引数 1 つの表示上限。長い値でも「どの呼び出しか」は判別できる長さに留める。 */
const PREVIEW_VALUE_MAX = 30;

function previewValue(v: unknown): string {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  return s.length > PREVIEW_VALUE_MAX ? s.slice(0, PREVIEW_VALUE_MAX - 3) + '...' : s;
}

/** 組み込み以外のツールのコール行末尾。受け取った引数をそのまま並べるだけ。 */
function formatArgPreview(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return ` { ${keys.map(k => `${k}: ${previewValue(args[k])}`).join(', ')} }`;
}

/** 文字列引数の取り出し。欠落・空文字は呼び出し側が指定した表示に落ちる。 */
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

/**
 * ツール呼び出しの1行表示 (グループカードのコール行・ツールのコール行表示で共用)。
 * tools.ts の renderCall から抽出したもの。mcp も他のツールと同じ規則で整形する。
 */
export function formatCallLine(toolName: string, args: any): string {
  // 引数はツール側の定義に依存する (オブジェクト以外もあり得る) ので、まず形を揃える
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};

  const limit = (v: unknown) => (typeof v === 'number' ? ` (limit ${v})` : '');
  let line: string;

  switch (toolName) {
    case 'bash':
      // 切り詰めない: Text コンポーネントが端末幅で折り返すため、長いコマンドでも
      // 末尾 (実行内容そのもの) が失われない。ホストの formatBashCall と同じ方針。
      line = `$ ${typeof args.command === 'string' ? args.command : ''}`;
      break;

    case 'read': {
      // ホスト formatReadCall / formatReadLineRange と同じ書式:
      // `read <path>` または `read <path>:<start>[-<end>]`
      const hasRange = args.offset !== undefined || args.limit !== undefined;
      const start = typeof args.offset === 'number' ? args.offset : 1;
      const range = !hasRange
        ? ''
        : `:${start}${typeof args.limit === 'number' ? `-${start + args.limit - 1}` : ''}`;
      line = `read ${str(args.file_path ?? args.path, '...')}${range}`;
      break;
    }

    case 'write': {
      const n = typeof args.content === 'string' ? args.content.split('\n').length : 0;
      line = `write ${str(args.path, '...')}` + (n > 0 ? ` (${n} lines)` : '');
      break;
    }

    case 'edit':
      line = `edit ${str(args.path, '...')}`;
      break;

    case 'ls':
      line = `ls ${str(args.path, '.')}${limit(args.limit)}`;
      break;

    case 'find':
      line = `find ${str(args.pattern, '')} in ${str(args.path, '.')}${limit(args.limit)}`;
      break;

    case 'grep':
      line = `grep /${str(args.pattern, '')}/ in ${str(args.path, '.')}`;
      if (str(args.glob, '') !== '') line += ` (${args.glob})`;
      line += limit(args.limit);
      break;

    default:
      // 組み込み以外のツールは、引数の意味を本拡張が知らない。値の形を推測せず
      // そのまま並べることで、新しい拡張が登録されてもコード追加が不要になる。
      line = `${getEffectiveToolName(toolName, args)}${formatArgPreview(args)}`;
  }

  return sanitizeToolText(line);
}

/**
 * ツール結果から「画面に出すテキスト」を決める (edit は details.diff、write は args.content に本体がある)。
 * content は全 text ブロックを改行連結する — Pi 本体 getTextOutput と同じで、1 件目だけ見ると 2 件目以降が消える。
 */
export function resolveResultText(toolName: string, args: any, result: any): string {
  // edit の差分 (成功時のみ。エラー時は content にエラー文が入っている)
  if (toolName === "edit" && !result?.isError) {
    const diff = result?.details?.diff;
    if (typeof diff === "string" && diff) return diff;
  }

  // write の書き込み内容 (成功時のみ。エラー時は content にエラー文が入っている)
  if (toolName === "write" && !result?.isError) {
    const c = args?.content;
    if (typeof c === "string") return c;
  }

  // 既定: content の全 text ブロックを改行で連結する
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b?.text ?? "")
    .join("\n");
}

/**
 * 整形済みのツール結果テキストを着色する。edit の diff のみ行頭 +/- に意味があるため renderDiff を使う。
 * (formatOutput は ANSI を除去するので、必ず整形後に呼ぶこと)
 */
export function colorizeResult(toolName: string, text: string, theme: any): string {
  if (!text) return "";

  const colorizePlain = (t: string) =>
    t.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");

  if (toolName !== "edit") return colorizePlain(text);

  try {
    return renderDiff(text);
  } catch {
    // テーマ未初期化などで renderDiff が失敗しても表示は壊さない
    return colorizePlain(text);
  }
}

