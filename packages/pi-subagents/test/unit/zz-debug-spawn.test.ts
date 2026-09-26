import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

test("debug spawn env", () => {
  const lines: string[] = [];
  lines.push("NODE_OPTIONS: " + JSON.stringify(process.env.NODE_OPTIONS ?? "(none)"));
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    const out = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./test/support/register-loader.mjs",
        "--input-type=module",
        "--eval",
        'import registerSubagentExtension from "./index.ts"; console.log("LOADED", typeof registerSubagentExtension);',
      ],
      { cwd: projectRoot, stdio: "pipe", env: { ...process.env } },
    );
    lines.push("OK: " + out.toString().slice(0, 200));
  } catch (err) {
    const e = err as { stderr?: Buffer; message?: string };
    lines.push("STDERR: " + (e.stderr?.toString().slice(0, 2000) ?? "(none)"));
    lines.push("MSG: " + (e.message?.slice(0, 400) ?? ""));
  }
  fs.writeFileSync("/tmp/spawn-debug.txt", lines.join("\n"));
});
