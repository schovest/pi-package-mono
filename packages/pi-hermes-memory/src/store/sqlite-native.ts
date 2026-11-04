/**
 * Shared better-sqlite3 loader with ABI mismatch recovery.
 *
 * Pi installs extension deps under ~/.pi/agent/npm. When the host Node that
 * runs Pi (e.g. Homebrew) differs from the Node that compiled better-sqlite3,
 * the native dlopen throws NODE_MODULE_VERSION errors. Detect that, attempt one
 * npm rebuild against the current runtime, and surface a clear recovery path.
 *
 * better-sqlite3 >= 12 resolves its addon lazily inside lib/database.js on the
 * first Database construction, so a plain require("better-sqlite3") never
 * dlopens. loadBetterSqlite3 therefore probes the addon eagerly (see
 * probeBetterSqlite3NativeAddon): without it, load failures would surface at
 * first use — outside this recovery path — and every later attempt in the same
 * process would fail with the misleading "Module did not self-register" (the
 * failed dlopen stays registered with Node and cached by the dynamic linker
 * until the process exits).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type BetterSqlite3DatabaseCtor = new (
  dbPath: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
) => unknown;

export interface SqliteNativeLoadOptions {
  /** Override createRequire base URL (tests). */
  requireFrom?: string | URL;
  /** Inject require() for tests. */
  requireImpl?: NodeRequire;
  /** Inject rebuild runner for tests. */
  rebuild?: (packageRoot: string) => { ok: boolean; detail: string };
  /** Force treating the first load failure as rebuild-eligible (tests). */
  allowRebuild?: boolean;
}

export class BetterSqlite3LoadError extends Error {
  readonly code = "BETTER_SQLITE3_LOAD_FAILED";
  readonly packageRoot: string | null;
  readonly causeError: unknown;

  constructor(message: string, options: { packageRoot?: string | null; cause?: unknown } = {}) {
    super(message);
    this.name = "BetterSqlite3LoadError";
    this.packageRoot = options.packageRoot ?? null;
    this.causeError = options.cause;
  }
}

const ABI_MISMATCH_RE =
  /NODE_MODULE_VERSION|was compiled against a different Node\.js version|did not self-register|ERR_DLOPEN_FAILED/i;

/**
 * True when running under Bun (including the compiled Pi binary).
 *
 * Compiled Pi cannot resolve `better-sqlite3` — neither the bare specifier nor
 * the package's own transitive `require("bindings")` resolve from an on-disk
 * extension file, so every code path that needs SQLite must route through
 * `bun:sqlite` instead of loading the native module.
 */
export function isBunRuntime(): boolean {
  return "Bun" in globalThis;
}

export function isNativeModuleAbiMismatch(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (ABI_MISMATCH_RE.test(message)) return true;
  if (typeof error === "object" && error !== null) {
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "ERR_DLOPEN_FAILED") return true;
  }
  return false;
}

export function resolveBetterSqlite3PackageRoot(requireImpl: NodeRequire): string | null {
  try {
    const entry = requireImpl.resolve("better-sqlite3");
    let dir = path.dirname(entry);
    while (true) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const raw = fs.readFileSync(pkgPath, "utf-8");
          const pkg = JSON.parse(raw) as { name?: unknown };
          if (pkg && typeof pkg === "object" && pkg.name === "better-sqlite3") return dir;
        } catch {
          // keep walking
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // Classic layout fallback: .../node_modules/better-sqlite3/<...>
    const parts = entry.split(path.sep);
    const idx = parts.lastIndexOf("better-sqlite3");
    if (idx >= 0) {
      return parts.slice(0, idx + 1).join(path.sep) || null;
    }
    return path.dirname(entry);
  } catch {
    return null;
  }
}
function defaultRebuild(packageRoot: string): { ok: boolean; detail: string } {
  const npmExecPath =
    typeof process.env.npm_execpath === "string" && process.env.npm_execpath ? process.env.npm_execpath : null;

  const attempts: Array<{ command: string; args: string[]; shell?: boolean }> = [];
  if (npmExecPath) {
    attempts.push({ command: process.execPath, args: [npmExecPath, "rebuild", "better-sqlite3"] });
  }
  attempts.push({ command: "npm", args: ["rebuild", "better-sqlite3"] });

  const details: string[] = [];
  for (const attempt of attempts) {
    const result = spawnSync(attempt.command, attempt.args, {
      cwd: packageRoot,
      encoding: "utf-8",
      env: process.env,
      timeout: 120_000,
      shell: attempt.shell ?? false,
    });
    if (result.error) {
      details.push(`${attempt.command}: ${result.error.message}`);
      continue;
    }
    if (result.status === 0) {
      return { ok: true, detail: (result.stdout || result.stderr || "rebuild ok").trim() };
    }
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    details.push(`${attempt.command} exited ${result.status}${output ? `: ${output}` : ""}`);
  }

  return { ok: false, detail: details.join(" | ") || "rebuild failed" };
}

function unwrapModule(
  mod: { default?: BetterSqlite3DatabaseCtor } | BetterSqlite3DatabaseCtor,
): BetterSqlite3DatabaseCtor {
  return (mod as { default?: BetterSqlite3DatabaseCtor }).default ?? (mod as BetterSqlite3DatabaseCtor);
}

function clearBetterSqlite3RequireCache(requireImpl: NodeRequire, packageRoot: string | null): void {
  for (const key of Object.keys(requireImpl.cache)) {
    if (!key.includes(`${path.sep}better-sqlite3${path.sep}`) && !key.endsWith(`${path.sep}better-sqlite3`)) {
      continue;
    }
    if (packageRoot && !key.startsWith(packageRoot)) continue;
    delete requireImpl.cache[key];
  }
}

export function formatBetterSqlite3AbiError(options: {
  originalError: unknown;
  packageRoot: string | null;
  rebuildAttempted: boolean;
  rebuildDetail?: string;
}): string {
  const original =
    options.originalError instanceof Error ? options.originalError.message : String(options.originalError);
  const runtime = `Node ${process.version} (NODE_MODULE_VERSION ${process.versions.modules}) via ${process.execPath}`;
  const location = options.packageRoot ?? "(better-sqlite3 package root unknown)";
  const rebuildLine = options.rebuildAttempted
    ? options.rebuildDetail
      ? `Automatic rebuild was attempted and failed: ${options.rebuildDetail}`
      : "Automatic rebuild was attempted and failed."
    : "Automatic rebuild was not attempted.";

  return [
    "pi-hermes-memory could not load the native better-sqlite3 module for this Node runtime.",
    `Runtime: ${runtime}`,
    `Module: ${location}`,
    `Original error: ${original}`,
    rebuildLine,
    "Fix: rebuild the extension install against the same Node that runs Pi, then restart Pi:",
    options.packageRoot
      ? `  cd "${options.packageRoot}" && npm rebuild better-sqlite3`
      : "  cd ~/.pi/agent/npm && npm rebuild better-sqlite3",
    "If you installed Pi with Homebrew, either rebuild as above after brew Node upgrades, or install Pi with npm so the extension and host share one Node toolchain.",
  ].join("\n");
}

/**
 * Probe better-sqlite3's native addon so the real dlopen runs inside this
 * loader's try/catch instead of lazily at first Database construction.
 *
 * Requiring the addon file directly shares Node's module cache with the later
 * `require('bindings')('better_sqlite3.node')` inside lib/database.js (same
 * resolved path), so this is purely an eager load — no double dlopen.
 *
 * When no addon exists in the standard build layouts (unusual installs, test
 * fakes), probing is skipped and loading behaves exactly as before.
 */
function probeBetterSqlite3NativeAddon(requireImpl: NodeRequire): void {
  const packageDir = resolveBetterSqlite3PackageRoot(requireImpl);
  if (!packageDir) return;
  for (const candidate of [
    ["build", "Release", "better_sqlite3.node"],
    ["build", "Debug", "better_sqlite3.node"],
  ]) {
    const addonPath = path.join(packageDir, ...candidate);
    if (!fs.existsSync(addonPath)) continue;
    requireImpl(addonPath);
    return;
  }
}

/**
 * Package roots whose rebuild already ran and still failed to make the module
 * loadable in this process. Native addons cannot be unloaded, so the first
 * failed dlopen keeps its stale registration (and the dynamic linker keeps the
 * mapped file) until the process exits — retrying would only re-run npm
 * rebuild for nothing. Restarting Pi picks up the repaired module.
 */
const terminalRebuildFailures = new Set<string>();

/**
 * Test hook: clears the process-level terminal rebuild-failure memory so each
 * test starts from a clean loader state.
 */
export function resetBetterSqlite3LoadState(): void {
  terminalRebuildFailures.clear();
}

/**
 * Load better-sqlite3, attempting one rebuild on ABI/dlopen mismatch.
 */
export function loadBetterSqlite3(options: SqliteNativeLoadOptions = {}): BetterSqlite3DatabaseCtor {
  const requireImpl = options.requireImpl ?? createRequire(options.requireFrom ?? import.meta.url);

  const loadOnce = (): BetterSqlite3DatabaseCtor => {
    const mod = requireImpl("better-sqlite3") as { default?: BetterSqlite3DatabaseCtor } | BetterSqlite3DatabaseCtor;
    probeBetterSqlite3NativeAddon(requireImpl);
    return unwrapModule(mod);
  };

  try {
    return loadOnce();
  } catch (firstError) {
    const packageRoot = resolveBetterSqlite3PackageRoot(requireImpl);
    const canRebuild = options.allowRebuild ?? isNativeModuleAbiMismatch(firstError);
    if (!canRebuild || !packageRoot) {
      if (isNativeModuleAbiMismatch(firstError)) {
        throw new BetterSqlite3LoadError(
          formatBetterSqlite3AbiError({
            originalError: firstError,
            packageRoot,
            rebuildAttempted: false,
          }),
          { packageRoot, cause: firstError },
        );
      }
      throw firstError;
    }

    if (terminalRebuildFailures.has(packageRoot)) {
      throw new BetterSqlite3LoadError(
        formatBetterSqlite3AbiError({
          originalError: firstError,
          packageRoot,
          rebuildAttempted: true,
          rebuildDetail:
            "an earlier automatic rebuild already ran in this process; restart Pi to load the repaired module",
        }),
        { packageRoot, cause: firstError },
      );
    }

    const rebuild = options.rebuild ?? defaultRebuild;
    const rebuildResult = rebuild(packageRoot);
    clearBetterSqlite3RequireCache(requireImpl, packageRoot);

    if (rebuildResult.ok) {
      try {
        return loadOnce();
      } catch (secondError) {
        terminalRebuildFailures.add(packageRoot);
        throw new BetterSqlite3LoadError(
          formatBetterSqlite3AbiError({
            originalError: secondError,
            packageRoot,
            rebuildAttempted: true,
            rebuildDetail: rebuildResult.detail,
          }),
          { packageRoot, cause: secondError },
        );
      }
    }

    terminalRebuildFailures.add(packageRoot);
    throw new BetterSqlite3LoadError(
      formatBetterSqlite3AbiError({
        originalError: firstError,
        packageRoot,
        rebuildAttempted: true,
        rebuildDetail: rebuildResult.detail,
      }),
      { packageRoot, cause: firstError },
    );
  }
}
