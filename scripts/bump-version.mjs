#!/usr/bin/env node
/**
 * 按包升级版本（每个包独立维护版本号，不再 lockstep）。
 *
 * 用法：
 *   node scripts/bump-version.mjs <patch|minor|major> <包目录名|scoped 包名>
 *   npm run version:minor -- pi-ask-user-question
 *
 * 步骤：
 *   1. npm version <level> --workspace <name> --no-git-tag-version — 只升目标包
 *   2. scripts/sync-versions.js — 把 workspace 内部依赖引用同步到当前版本
 *   3. npm install --package-lock-only — lockfile 与 manifest 保持一致（CI 的 npm ci 依赖）
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const level = process.argv[2];
const target = process.argv[3];

if (!["patch", "minor", "major"].includes(level)) {
  console.error("用法: node scripts/bump-version.mjs <patch|minor|major> <包目录名|scoped 包名>");
  console.error("例如: npm run version:minor -- pi-ask-user-question");
  process.exit(1);
}
if (!target) {
  console.error("❌ 缺少包名参数。用法: node scripts/bump-version.mjs <patch|minor|major> <包>");
  process.exit(1);
}

// 解析目标：支持包目录名（pi-ask-user-question）或 scoped 包名（@schovest/pi-ask-user-question）
const packagesDir = join(root, "packages");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`❌ 无法解析 ${path}: ${e.message}`);
    process.exit(1);
  }
}

// 解析目标：支持包目录名（pi-ask-user-question）或 scoped 包名（@schovest/pi-ask-user-question）
let name = null;
let pkgPath = null;
for (const dir of readdirSync(packagesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const path = join(packagesDir, dir.name, "package.json");
  const pkg = readJson(path);
  if (dir.name === target || pkg.name === target) {
    name = pkg.name;
    pkgPath = path;
    break;
  }
}
if (!name) {
  console.error(`❌ 找不到包: ${target}`);
  process.exit(1);
}

console.log(`bump ${name} (${level})`);
execFileSync("npm", ["version", level, "--workspace", name, "--no-git-tag-version"], { stdio: "inherit", cwd: root });

// npm version 以 2 空格缩进重写 package.json，仓库约定是 tab——规范化回来
const normalized = `${JSON.stringify(readJson(pkgPath), null, "\t")}\n`;
writeFileSync(pkgPath, normalized);

// 同步 workspace 内部依赖引用（被升级包的依赖方会指向新版本）
execFileSync("node", ["scripts/sync-versions.js"], { stdio: "inherit", cwd: root });

// lockfile 与 manifest 保持一致（CI 的 npm ci 要求严格同步）
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { stdio: "inherit", cwd: root });

const bumped = readJson(pkgPath).version;
console.log(`\n✅ ${name} → ${bumped}（记得更新该包 CHANGELOG 并提交）`);
