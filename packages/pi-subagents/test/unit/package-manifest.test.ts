import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const sourceImportPattern = /from\s+["'](@earendil-works\/[^"']+)["']|import\s+["'](@earendil-works\/[^"']+)["']/g;
const oldPiScopePattern = /@mariozechner\/pi-/;
const piPackageJsonSubpathPattern = /@earendil-works\/pi-[^"']+\/package\.json/;
const cjsPiPackageResolutionPattern = /require(?:\.resolve)?\(\s*["']@earendil-works\/pi-/;
const exactVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const hostPeerPackages = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
] as const;
const expectedHostPeerRanges = {
  "@earendil-works/pi-agent-core": "*",
  "@earendil-works/pi-ai": ">=0.86.1",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
} satisfies Record<(typeof hostPeerPackages)[number], string>;
const expectedHostDevVersions = {
  "@earendil-works/pi-agent-core": "0.87.1",
  "@earendil-works/pi-ai": "0.87.1",
  "@earendil-works/pi-coding-agent": "0.87.1",
  "@earendil-works/pi-tui": "0.87.1",
} satisfies Record<(typeof hostPeerPackages)[number], string>;

test("the root entrypoint exposes the runtime error flag to TypeScript consumers", () => {
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-types-"));
  try {
    fs.writeFileSync(
      path.join(consumerRoot, "consumer.ts"),
      `
import "@schovest/pi-subagents";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { registerWorkflowResource, type RegisterWorkflowResourceInput, type WorkflowResourceDefinition, type WorkflowResourceRegistration } from "@schovest/pi-subagents/workflow-resources";

const definition: WorkflowResourceDefinition = {
	name: "consumer.check", version: 1,
	resolve: (args) => typeof args.task === "string"
		? { script: "return 1;", hostCommands: [{ key: "check", command: "node --version" }] }
		: { error: "task required" },
};
const input: RegisterWorkflowResourceInput = { sessionId: "consumer", definition };
const registration: WorkflowResourceRegistration = registerWorkflowResource(input);
registration.dispose();

const result: AgentToolResult<undefined> = {
	content: [],
	details: undefined,
	isError: true,
};

void result.isError;
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(consumerRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            types: ["node"],
            typeRoots: [path.join(projectRoot, "node_modules", "@types")],
            skipLibCheck: true,
            allowImportingTsExtensions: true,
            // baseUrl 已被 TypeScript 6 弃用；paths 均为绝对路径，无需 baseUrl。
            paths: {
              "@schovest/pi-subagents": [path.join(projectRoot, "index.ts")],
              "@schovest/pi-subagents/workflow-resources": [path.join(projectRoot, "src/api/workflow-resources.ts")],
              "@earendil-works/pi-agent-core": [
                // 移植适配：pi-agent-core 0.87.1 无版本冲突，被 npm hoist 到仓根 node_modules。
                path.join(
                  projectRoot,
                  "..",
                  "..",
                  "node_modules",
                  "@earendil-works",
                  "pi-agent-core",
                  "dist",
                  "index.d.ts",
                ),
              ],
            },
          },
          files: [path.join(consumerRoot, "consumer.ts")],
        },
        null,
        2,
      ),
      "utf-8",
    );

    execFileSync(
      process.execPath,
      [
        // 移植适配：typescript 是仓根 devDep（hoist 到仓根 node_modules），不在本包内。
        path.join(projectRoot, "..", "..", "node_modules", "typescript", "bin", "tsc"),
        "--project",
        path.join(consumerRoot, "tsconfig.json"),
      ],
      {
        cwd: consumerRoot,
        stdio: "pipe",
      },
    );
  } finally {
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
});

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const file of collectSourceFiles(entryPath)) files.push(file);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) {
      files.push(entryPath);
    }
  }
  return files;
}

test("published extension APIs use supported package entrypoints", async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

  assert.ok(!packageJson.private, "the fork package must be publishable");
  assert.deepEqual(packageJson.pi?.extensions, ["./index.ts"]);
  assert.equal(packageJson.files?.includes("index.ts"), true);
  assert.equal(packageJson.files?.includes("*.mjs"), true);
  assert.equal(fs.existsSync(path.join(projectRoot, "async-retention-discovery-worker.mjs")), true);
  const entrySource = fs.readFileSync(path.join(projectRoot, "index.ts"), "utf-8");
  assert.match(entrySource, /import type \{\} from "\.\/src\/types\/pi-runtime-compat\.d\.ts";/);
  assert.equal(entrySource.includes('export { default } from "./src/extension/index.ts";'), false);
  assert.match(entrySource, /process\.env\.PI_SUBAGENT_CHILD === "1"/);
  assert.match(entrySource, /await import\("\.\/src\/extension\/index\.ts"\)/);
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "api", "delegation.ts")), true);
  assert.deepEqual(packageJson.exports, {
    ".": "./index.ts",
    "./agents": "./src/api/agents.ts",
    "./background-work": "./src/api/background-work.ts",
    "./external-job-provider": "./src/api/external-job-provider.ts",
    "./external-runs": "./src/api/external-runs.ts",
    "./capability-ceiling": "./src/api/capability-ceiling.ts",
    "./workflow-resources": "./src/api/workflow-resources.ts",
    "./required-child-extensions": "./src/api/required-child-extensions.ts",
    "./delegation": "./src/api/delegation.ts",
    "./preflight": "./src/api/preflight.ts",
    "./control-channel": "./src/api/control-channel.ts",
    "./intercom-bridge": "./src/api/intercom-bridge.ts",
    "./child-tool-plan": "./src/api/child-tool-plan.ts",
    "./shared-types": "./src/api/shared-types.ts",
    "./project-panes": "./src/api/project-panes.ts",
  });
  const agents = await import("@schovest/pi-subagents/agents");
  assert.equal(agents.RUNTIME_AGENT_REGISTER_EVENT, "pi-subagents:runtime-agent-register:v1");
  assert.equal(agents.RUNTIME_AGENT_REGISTER_VERSION, 1);
  assert.equal(typeof agents.registerAgentViaEvents, "function");
  const backgroundWork = await import("@schovest/pi-subagents/background-work");
  assert.equal(backgroundWork.BACKGROUND_WORK_PROTOCOL_VERSION, 1);
  assert.equal(backgroundWork.BACKGROUND_WORK_REGISTRY_KEY, "pi-subagents.background-work.v1");
  const externalJobProvider = await import("@schovest/pi-subagents/external-job-provider");
  assert.equal(externalJobProvider.EXTERNAL_JOB_PROVIDER_PROTOCOL_VERSION, 1);
  assert.equal(externalJobProvider.EXTERNAL_JOB_PROVIDER_REGISTRY_KEY, "pi-subagents.external-job-providers.v1");
  assert.equal(typeof externalJobProvider.registerExternalJobProvider, "function");
  const externalRuns = await import("@schovest/pi-subagents/external-runs");
  assert.equal(externalRuns.EXTERNAL_RUN_REGISTRY_VERSION, 2);
  assert.equal(typeof externalRuns.registerExternalRun, "function");
  assert.equal(typeof externalRuns.updateExternalRun, "function");
  assert.equal(typeof externalRuns.snapshotExternalRuns, "function");
  assert.equal(typeof externalRuns.unregisterExternalRun, "function");
  const capability = await import("@schovest/pi-subagents/capability-ceiling");
  const workflowResources = await import("@schovest/pi-subagents/workflow-resources");
  assert.deepEqual(Object.keys(workflowResources), ["registerWorkflowResource"]);
  assert.equal(typeof workflowResources.registerWorkflowResource, "function");
  assert.equal(capability.SUBAGENT_CAPABILITY_CEILING_VERSION, 1);
  assert.equal(capability.SUBAGENT_CAPABILITY_CEILING_REGISTRY_KEY, "pi-subagents.capability-ceiling.v1");
  const delegation = await import("@schovest/pi-subagents/delegation");
  assert.equal(delegation.SUBAGENT_DELEGATION_REQUEST_EVENT, "prompt-template:subagent:request");
  const preflight = await import("@schovest/pi-subagents/preflight");
  assert.equal(preflight.SUBAGENT_LAUNCH_CONTRACT_VERSION, 3);
  assert.equal(typeof preflight.resolveSubagentLaunchContract, "function");
  const controlChannel = await import("@schovest/pi-subagents/control-channel");
  assert.equal(typeof controlChannel.requestAsyncStop, "function");
  const intercomBridge = await import("@schovest/pi-subagents/intercom-bridge");
  assert.equal(typeof intercomBridge.resolveIntercomSessionTarget, "function");
  const childToolPlan = await import("@schovest/pi-subagents/child-tool-plan");
  assert.equal(typeof childToolPlan.resolvePiLaunchToolPlan, "function");
  assert.deepEqual(Object.keys(childToolPlan).sort(), ["resolvePiLaunchToolPlan"]);
  const sharedTypes = await import("@schovest/pi-subagents/shared-types");
  assert.equal(typeof sharedTypes.wrapForkTask, "function");
  assert.equal(typeof sharedTypes.DEFAULT_FORK_PREAMBLE, "string");
  assert.equal("TEMP_ROOT_DIR" in sharedTypes, false);
  const projectPanes = await import("@schovest/pi-subagents/project-panes");
  assert.equal(projectPanes.PROJECT_PANES_API_VERSION, 1);
  assert.equal(typeof projectPanes.openProjectPane, "function");
  assert.equal(typeof projectPanes.getProjectPaneStatus, "function");
  assert.equal(typeof projectPanes.closeProjectPane, "function");
});

test("direct @earendil-works runtime imports are declared for CI installs", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
  const imported = new Set<string>();

  for (const file of [
    ...collectSourceFiles(path.join(projectRoot, "src")),
    ...collectSourceFiles(path.join(projectRoot, "test")),
  ]) {
    const source = fs.readFileSync(file, "utf-8");
    for (const match of source.matchAll(sourceImportPattern)) {
      const specifier = match[1] ?? match[2]!;
      imported.add(specifier.split("/").slice(0, 2).join("/"));
    }
  }

  const missing = [...imported].filter((specifier) => !declared.has(specifier)).sort();
  assert.deepEqual(missing, []);
});

test("direct dependency declarations are exact version pins", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

  // 移植适配：typebox 跟随仓根约定使用 ^ 范围（由 workspace 版本同步脚本管理），其余保持精确 pin。
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const [name, version] of Object.entries<string>(packageJson[section] ?? {})) {
      if (section === "devDependencies" && name === "typebox") continue;
      assert.match(version, exactVersionPattern, `${section}.${name} should use an exact version`);
    }
  }
  assert.equal(packageJson.devDependencies?.typebox, "^1.3.0");
});

test("host-owned packages are optional peers with supported ranges, not production dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

  for (const name of hostPeerPackages) {
    assert.equal(
      packageJson.peerDependencies?.[name],
      expectedHostPeerRanges[name],
      `${name} should use its supported peer range`,
    );
    assert.equal(packageJson.dependencies?.[name], undefined, `${name} should not be a production dependency`);
    assert.deepEqual(
      packageJson.peerDependenciesMeta?.[name],
      { optional: true },
      `${name} should be an optional peer`,
    );
  }
});
test("typebox resolves through the host peer with a dev-only range pin", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

  // 移植适配：fork 不打包 typebox，改由宿主 peer 提供（optional），devDeps 仅用于类型检查。
  assert.equal(packageJson.dependencies?.typebox, undefined);
  assert.equal(packageJson.peerDependencies?.typebox, "*");
  assert.deepEqual(packageJson.peerDependenciesMeta?.typebox, { optional: true });
  assert.equal(packageJson.devDependencies?.typebox, "^1.3.0");
});

test("host-owned development packages use the supported SDK baseline", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

  for (const [name, version] of Object.entries(expectedHostDevVersions)) {
    assert.equal(packageJson.devDependencies?.[name], version, `${name} should use ${version}`);
  }
});

test("old pi package scope is not used by source or tests", () => {
  for (const file of [
    ...collectSourceFiles(path.join(projectRoot, "src")),
    ...collectSourceFiles(path.join(projectRoot, "test")),
  ]) {
    const source = fs.readFileSync(file, "utf-8");
    assert.equal(oldPiScopePattern.test(source), false, file);
  }
});

test("Pi package resolution stays export-map safe", () => {
  for (const file of [
    ...collectSourceFiles(path.join(projectRoot, "src")),
    ...collectSourceFiles(path.join(projectRoot, "test")),
  ]) {
    const source = fs.readFileSync(file, "utf-8");
    assert.equal(
      piPackageJsonSubpathPattern.test(source),
      false,
      `${file} should not resolve unexported package.json subpaths`,
    );
    assert.equal(
      cjsPiPackageResolutionPattern.test(source),
      false,
      `${file} should not use CommonJS resolution for ESM-only Pi packages`,
    );
  }
});
