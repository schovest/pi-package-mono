#!/usr/bin/env node
/**
 * 发布 npm workspaces 中的包——跳过 private 包与已发布的包/版本。
 *
 * 用法：
 *   node scripts/publish-packages.mjs              # 默认：发布当前版本未发布的包
 *   node scripts/publish-packages.mjs first        # 首次：只发布从未发布过的包
 *   node scripts/publish-packages.mjs --dry-run    # 预演：检查但不真正发布
 *   node scripts/publish-packages.mjs --otp <code> # 提供 2FA 一次性密码（npm 账号 auth-and-writes 时需要）
 *
 * 跳过规则：
 *   - `private: true` 的包（如 pi-test-utils）永不发布
 *   - 默认模式：`npm view <name>@<version>` 命中 → 该版本已发布，跳过
 *   - first 模式：`npm view <name>` 命中 → 包已存在于 registry（无论版本），跳过
 *
 * 2FA（OTP）：
 *   - 可通过 `--otp <code>` 或环境变量 `NPM_OTP` 提供
 *   - 未提供时，遇到 EOTP 错误会交互式询问；同一 OTP 过期会再次询问
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const firstMode = args.includes("first");
const dryRun = args.includes("--dry-run");
const otpIndex = args.indexOf("--otp");
let otp = otpIndex >= 0 ? args[otpIndex + 1] : (process.env.NPM_OTP ?? null);

const packagesDir = join(root, "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true }).filter((d) => d.isDirectory());

function isPublished(query) {
  try {
    execFileSync("npm", ["view", query, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function askOtp() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("输入 2FA 一次性密码（OTP）：")).trim();
  rl.close();
  return code;
}

function runPublish(name) {
  const cmd = ["publish", "--workspace", name, "--access", "public"];
  if (dryRun) cmd.push("--dry-run");
  if (otp) cmd.push("--otp", otp);
  try {
    execFileSync("npm", cmd, { stdio: "inherit", cwd: root });
    return true;
  } catch (err) {
    const msg = String(err.stderr ?? "");
    const isEotp = /EOTP|one-time password/i.test(msg);
    if (!isEotp || dryRun) throw err;
    return false;
  }
}

let publishedCount = 0;
let skippedCount = 0;

for (const dir of packageDirs) {
  const pkgPath = join(packagesDir, dir.name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    continue;
  }
  if (!pkg.name) continue;

  if (pkg.private) {
    console.log(`skip ${pkg.name}@${pkg.version} (private, not published)`);
    skippedCount++;
    continue;
  }

  const query = firstMode ? pkg.name : `${pkg.name}@${pkg.version}`;
  if (isPublished(query)) {
    console.log(`skip ${pkg.name}@${pkg.version} (${firstMode ? "already published" : "version already published"})`);
    skippedCount++;
    continue;
  }

  console.log(`publish ${pkg.name}@${pkg.version}${dryRun ? " (dry-run)" : ""}`);
  // 2FA 循环：EOTP 时询问新 OTP 重试，直到成功或非 OTP 错误
  for (;;) {
    if (runPublish(pkg.name)) break;
    otp = await askOtp();
  }
  publishedCount++;
}

console.log(`\n✅ done: ${publishedCount} published, ${skippedCount} skipped${dryRun ? " (dry-run)" : ""}`);
