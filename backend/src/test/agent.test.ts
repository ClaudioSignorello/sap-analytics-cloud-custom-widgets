import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatError, PlanningAgent, type CreateMessage } from "../agent.js";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function fakeMessage(content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage {
  return { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: {} } as unknown as Anthropic.Beta.BetaMessage;
}

function agentWith(responses: Anthropic.Beta.BetaMessage[]) {
  const calls: Params[] = [];
  const create: CreateMessage = async (p) => {
    calls.push(structuredClone(p));
    const r = responses.shift();
    if (!r) throw new Error("keine Antwort mehr");
    return r;
  };
  return { calls, agent: new PlanningAgent(create, { model: "claude-opus-5-5", effort: "medium", sessionTtlMs: 60_000, maxSessions: 10 }) };
}

const user = (text: string) => ({ sessionId: "s1", messages: [{ role: "user" as const, content: text }], context: { model: { dimensions: [] } } });

test("Lese-Tool wird ans Widget gegeben, Ergebnis führt zur Antwort", async () => {
  const { agent, calls } = agentWith([
    fakeMessage([{ type: "tool_use", id: "tu1", name: "query_data", input: { filters: [{ dimension: "ProfitCenter", members: ["PC_1000"] }], groupBy: [], measures: [] } }], "tool_use"),
    fakeMessage([{ type: "text", text: "Der Umsatz beträgt 41.000." }], "end_turn"),
  ]);

  const r1 = await agent.handle(user("Umsatz PC 1000?"));
  assert.deepEqual(r1, { type: "tool_call", id: "tu1", name: "query_data", arguments: { filters: { ProfitCenter: ["PC_1000"] }, groupBy: [], measures: [] } });

  const first = calls[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(first.fallbacks, "default");
  const userContent = first.messages[0].content as Anthropic.Beta.BetaTextBlockParam[];
  assert.match(userContent[0].text, /^<sac_context>/);
  assert.equal(userContent[1].text, "Umsatz PC 1000?");

  const r2 = await agent.handle({ sessionId: "s1", messages: [], toolResult: { call: { id: "tu1", name: "query_data" }, output: { matchedRows: 4 } } });
  assert.deepEqual(r2, { type: "message", text: "Der Umsatz beträgt 41.000." });
  const history = calls[1].messages;
  assert.equal(history.length, 3);
  assert.equal(history[1].role, "assistant");
  assert.deepEqual((history[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0].tool_use_id, "tu1");
});

test("propose_action-Parameter werden zu einem Objekt", async () => {
  const { agent } = agentWith([
    fakeMessage([{ type: "text", text: "Ich bereite das vor." }, { type: "tool_use", id: "tu2", name: "propose_action", input: { actionId: "DISTRIBUTE_TO_PERIOD", params: [{ id: "Anteil", value: "0.8" }, { id: "Zielperiode", value: "202704" }], summary: "80 % auf April" } }], "tool_use"),
  ]);
  const r = await agent.handle(user("Verteile 80 % auf Periode 4"));
  assert.deepEqual(r, { type: "tool_call", id: "tu2", name: "propose_action", arguments: { actionId: "DISTRIBUTE_TO_PERIOD", params: { Anteil: "0.8", Zielperiode: "202704" }, summary: "80 % auf April" } });
});

test("falsche Tool-ID wird abgelehnt", async () => {
  const { agent } = agentWith([fakeMessage([{ type: "tool_use", id: "tu3", name: "get_context", input: {} }], "tool_use")]);
  await agent.handle(user("Warum keine Daten?"));
  await assert.rejects(
    agent.handle({ sessionId: "s1", messages: [], toolResult: { call: { id: "falsch", name: "get_context" }, output: {} } }),
    (e: unknown) => e instanceof ChatError && e.status === 409,
  );
});

test("neue Frage bei offener Aktion beantwortet den Tool-Aufruf als abgebrochen", async () => {
  const { agent, calls } = agentWith([
    fakeMessage([{ type: "tool_use", id: "tu4", name: "propose_action", input: { actionId: "SUBMIT", params: [], summary: "" } }], "tool_use"),
    fakeMessage([{ type: "text", text: "Ok." }], "end_turn"),
  ]);
  await agent.handle(user("Übernehmen"));
  await agent.handle(user("Doch nicht, zeig mir lieber den Umsatz"));
  const content = calls[1].messages[2].content as Anthropic.Beta.BetaContentBlockParam[];
  assert.equal(content[0].type, "tool_result");
  assert.equal((content[0] as Anthropic.Beta.BetaToolResultBlockParam).tool_use_id, "tu4");
  assert.equal(content[2].type, "text");
});

test("Refusal wird als freundliche Nachricht zurückgegeben", async () => {
  const { agent } = agentWith([fakeMessage([], "refusal")]);
  const r = await agent.handle(user("…"));
  assert.equal(r.type, "message");
});

test("Request ohne sessionId ist ein 400", async () => {
  const { agent } = agentWith([]);
  await assert.rejects(agent.handle({ messages: [] } as never), (e: unknown) => e instanceof ChatError && e.status === 400);
});
