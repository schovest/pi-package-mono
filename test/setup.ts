import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, vi } from "vitest";

const TEST_HOME = mkdtempSync(join(tmpdir(), "pi-pkg-test-home-"));
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;
process.env.PI_CODING_AGENT_DIR = undefined;
process.env.XDG_CONFIG_HOME = undefined;

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    getSupportedThinkingLevels: vi.fn(() => ["off", "minimal", "low", "medium", "high"]),
  };
});

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = undefined;
  process.env.XDG_CONFIG_HOME = undefined;

  const piAgentSettings = join(process.env.HOME!, ".pi", "agent", "settings.json");
  const xdgPiAgentDir = join(process.env.HOME!, ".config", "pi", "agent");
  rmSync(piAgentSettings, { force: true });
  rmSync(xdgPiAgentDir, { recursive: true, force: true });
});
