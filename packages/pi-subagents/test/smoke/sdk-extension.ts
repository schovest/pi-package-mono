import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";

export default function (pi) {
  const state = globalThis.__sdkSmoke;
  assert.equal(AgentSession, state.AgentSession);
  assert.equal(BACKGROUND_CONTEXT, state.BACKGROUND_CONTEXT);
  assert.equal(createModels, state.createModels);
  state.faux = fauxProvider({ provider: "sdk-smoke", models: [{ id: "local" }], tokensPerSecond: 100000 });
  state.faux.setResponses([fauxAssistantMessage("local response verified")]);
  pi.registerProvider(state.faux.provider);
  pi.on("session_start", () => {
    state.started++;
  });
  pi.on("session_shutdown", () => {
    state.stopped++;
  });
}
