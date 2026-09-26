import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

// 复刻上游 test/support/isolated-temp-root.mjs 的进程级隔离（vitest 版，仅覆盖 vitest 进程本身；
// 被 spawn 的子进程仍走原 .mjs --import 方案，那两个 loader 文件保留在盘上）。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-test-root-"));
fs.mkdirSync(tempRoot, { recursive: true });
if (process.platform === "darwin") fs.closeSync(fs.openSync(path.join(tempRoot, ".metadata_never_index"), "a"));
process.env.PI_SUBAGENTS_TEMP_ROOT = tempRoot;
process.env.TMPDIR = tempRoot;
process.env.TMP = tempRoot;
process.env.TEMP = tempRoot;
const isolatedHome = path.join(tempRoot, "home");
fs.mkdirSync(isolatedHome, { recursive: true });
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_CONFIG_HOME;
// 复刻上游 isolated-temp-root 的 loader 状态协议：vitest worker 相当于上游的 test-file 进程，
// 其 spawn 出的子进程据此保留 PI_CODING_AGENT_DIR 等注入 env（isolated-temp-root.mjs 对
// PI_SUBAGENTS_TEST_LOADER 未设置的进程会删除该变量）。
process.env.PI_SUBAGENTS_TEST_LOADER = "test-file";
// 上游 node --test 的进程 cwd 是包根，spawn 出的子进程依赖相对路径
// （--import ./test/support/register-loader.mjs 等）相对包根解析；vitest worker 默认在仓根，这里对齐。
process.chdir(fileURLToPath(new URL("../..", import.meta.url)));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
