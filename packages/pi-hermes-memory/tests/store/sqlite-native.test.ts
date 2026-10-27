import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "vitest";
import {
  BetterSqlite3LoadError,
  formatBetterSqlite3AbiError,
  isNativeModuleAbiMismatch,
  loadBetterSqlite3,
  resetBetterSqlite3LoadState,
  resolveBetterSqlite3PackageRoot,
} from "../../src/store/sqlite-native.js";

const require = createRequire(import.meta.url);

type RequireCache = Record<string, unknown>;

function fakeRequire(impl: (id: string) => unknown, resolveImpl: (id: string) => string): NodeRequire {
  return Object.assign(impl, {
    resolve: resolveImpl,
    cache: {} as RequireCache,
  }) as NodeRequire;
}

describe("sqlite-native loader", () => {
  beforeEach(() => {
    resetBetterSqlite3LoadState();
  });

  it("detects NODE_MODULE_VERSION ABI mismatch errors", () => {
    assert.equal(
      isNativeModuleAbiMismatch(
        new Error(
          "The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115",
        ),
      ),
      true,
    );
    assert.equal(isNativeModuleAbiMismatch(new Error("SQLITE_BUSY")), false);
  });

  it("detects ERR_DLOPEN_FAILED codes", () => {
    const err = Object.assign(new Error("dlopen failed"), { code: "ERR_DLOPEN_FAILED" });
    assert.equal(isNativeModuleAbiMismatch(err), true);
  });

  it("detects 'Module did not self-register' dlopen failures as ABI-class", () => {
    // After a failed dlopen poisons the process (the first error stays
    // registered with Node and cached by the dynamic linker), every retry in
    // that process fails with this message instead of the version mismatch.
    assert.equal(
      isNativeModuleAbiMismatch(
        new Error(
          "Module did not self-register: '/home/me/.pi/agent/npm/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
        ),
      ),
      true,
    );
  });

  it("resolves the installed better-sqlite3 package root", () => {
    const root = resolveBetterSqlite3PackageRoot(require);
    assert.ok(root);
    assert.equal(path.basename(root!), "better-sqlite3");
  });

  it("loads better-sqlite3 successfully in the current runtime", () => {
    const Database = loadBetterSqlite3({ requireImpl: require, allowRebuild: false });
    const db = new (
      Database as new (
        path: string,
      ) => {
        exec: (sql: string) => void;
        close: () => void;
      }
    )(":memory:");
    db.exec("SELECT 1");
    db.close();
  });

  it("rebuilds once on ABI mismatch then succeeds", () => {
    let calls = 0;
    const ctor = class FakeDb {};
    const req = fakeRequire(
      (id: string) => {
        assert.equal(id, "better-sqlite3");
        calls += 1;
        if (calls === 1) {
          throw new Error(
            "was compiled against a different Node.js version using NODE_MODULE_VERSION 115. Please try re-compiling",
          );
        }
        return ctor;
      },
      (id: string) => {
        assert.equal(id, "better-sqlite3");
        return path.join("/tmp/fake-npm/node_modules/better-sqlite3/lib/index.js");
      },
    );

    let rebuilt = false;
    const Database = loadBetterSqlite3({
      requireImpl: req,
      rebuild: (packageRoot) => {
        rebuilt = true;
        assert.equal(packageRoot, "/tmp/fake-npm/node_modules/better-sqlite3");
        return { ok: true, detail: "rebuilt" };
      },
    });

    assert.equal(Database, ctor);
    assert.equal(rebuilt, true);
    assert.equal(calls, 2);
  });

  it("throws BetterSqlite3LoadError with recovery guidance when rebuild fails", () => {
    const req = fakeRequire(
      (_id: string) => {
        throw new Error(
          "The module 'x.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 108",
        );
      },
      () => path.join("/tmp/fake-npm/node_modules/better-sqlite3/lib/index.js"),
    );

    assert.throws(
      () =>
        loadBetterSqlite3({
          requireImpl: req,
          rebuild: () => ({ ok: false, detail: "npm missing" }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof BetterSqlite3LoadError);
        const message = error.message;
        assert.match(message, /pi-hermes-memory could not load the native better-sqlite3 module/);
        assert.match(message, /npm rebuild better-sqlite3/);
        assert.match(message, /Homebrew/);
        assert.match(message, /npm missing/);
        assert.equal(error.packageRoot, "/tmp/fake-npm/node_modules/better-sqlite3");
        return true;
      },
    );
  });

  it("forces the native addon dlopen through recovery (lazy-load probe)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs3-probe-"));
    try {
      const packageDir = path.join(root, "better-sqlite3");
      const addonDir = path.join(packageDir, "build", "Release");
      fs.mkdirSync(addonDir, { recursive: true });
      const addonPath = path.join(addonDir, "better_sqlite3.node");
      fs.writeFileSync(addonPath, "dummy");

      const ctor = class FakeDb {};
      const addonObj = { Database: class {} };
      let addonLoads = 0;
      const req = fakeRequire(
        (id: string) => {
          if (id === "better-sqlite3") return ctor;
          if (id === addonPath) {
            addonLoads += 1;
            if (addonLoads === 1) {
              // First dlopen fails (wrong ABI) and poisons the process.
              throw new Error(
                "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 115",
              );
            }
            return addonObj;
          }
          throw new Error(`unexpected require: ${id}`);
        },
        (id: string) => {
          assert.equal(id, "better-sqlite3");
          return path.join(packageDir, "lib", "index.js");
        },
      );

      let rebuilds = 0;
      const Database = loadBetterSqlite3({
        requireImpl: req,
        rebuild: (packageRoot) => {
          rebuilds += 1;
          assert.equal(packageRoot, packageDir);
          return { ok: true, detail: "rebuilt" };
        },
      });

      assert.equal(Database, ctor);
      assert.equal(rebuilds, 1);
      assert.equal(addonLoads, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves loading to better-sqlite3 when no on-disk addon exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bs3-noaddon-"));
    try {
      const ctor = class FakeDb {};
      const required: string[] = [];
      const req = fakeRequire(
        (id: string) => {
          required.push(id);
          return ctor;
        },
        (id: string) => {
          assert.equal(id, "better-sqlite3");
          return path.join(root, "better-sqlite3", "lib", "index.js");
        },
      );

      let rebuilds = 0;
      const Database = loadBetterSqlite3({
        requireImpl: req,
        allowRebuild: false,
        rebuild: () => {
          rebuilds += 1;
          return { ok: true, detail: "should not run" };
        },
      });

      assert.equal(Database, ctor);
      assert.deepEqual(required, ["better-sqlite3"]);
      assert.equal(rebuilds, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not re-run rebuild on later calls after a terminal rebuild failure", () => {
    const root = path.join(os.tmpdir(), `bs3-terminal-${process.pid}`);
    const packageRoot = path.join(root, "better-sqlite3");
    const req = fakeRequire(
      () => {
        throw new Error("The module was compiled against a different Node.js version using NODE_MODULE_VERSION 999");
      },
      () => path.join(packageRoot, "lib", "index.js"),
    );

    let rebuilds = 0;
    const options = {
      requireImpl: req,
      rebuild: () => {
        rebuilds += 1;
        return { ok: false, detail: "npm missing" };
      },
    };

    assert.throws(() => loadBetterSqlite3(options), BetterSqlite3LoadError);
    assert.equal(rebuilds, 1);

    assert.throws(
      () => loadBetterSqlite3(options),
      (error: unknown) => {
        assert.ok(error instanceof BetterSqlite3LoadError);
        assert.match(error.message, /earlier automatic rebuild/);
        assert.match(error.message, /restart Pi/);
        return true;
      },
    );
    assert.equal(rebuilds, 1);
  });

  it("formats actionable ABI recovery text", () => {
    const message = formatBetterSqlite3AbiError({
      originalError: new Error("NODE_MODULE_VERSION 115"),
      packageRoot: "/Users/me/.pi/agent/npm/node_modules/better-sqlite3",
      rebuildAttempted: true,
      rebuildDetail: "exit 1",
    });
    assert.match(message, /NODE_MODULE_VERSION/);
    assert.match(message, /\/Users\/me\/\.pi\/agent\/npm\/node_modules\/better-sqlite3/);
    assert.match(message, /npm rebuild better-sqlite3/);
    assert.match(message, /Homebrew/);
  });

  it("does not rebuild for non-ABI load failures", () => {
    let rebuilt = false;
    const req = fakeRequire(
      () => {
        throw new Error("Cannot find module 'better-sqlite3'");
      },
      () => {
        throw new Error("not found");
      },
    );

    assert.throws(
      () =>
        loadBetterSqlite3({
          requireImpl: req,
          rebuild: () => {
            rebuilt = true;
            return { ok: true, detail: "should not run" };
          },
        }),
      /Cannot find module 'better-sqlite3'/,
    );
    assert.equal(rebuilt, false);
  });
});
