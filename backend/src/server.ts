import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { ChatError, PlanningAgent, type ChatRequest } from "./agent.js";

const PORT = Number(process.env.PORT ?? 8787);
// Kommagetrennte Liste, z. B. https://mein-tenant.eu10.hcs.cloud.sap
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_BODY_BYTES = 1_000_000;

const client = new Anthropic(); // liest ANTHROPIC_API_KEY
const agent = new PlanningAgent((params) => client.beta.messages.create(params), {
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  effort: (process.env.CLAUDE_EFFORT as "low" | "medium" | "high") ?? "medium",
  sessionTtlMs: 60 * 60 * 1000,
  maxSessions: 1000,
});

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Server-zu-Server oder curl
  if (!ALLOWED_ORIGINS.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  return true;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ChatError("Request zu groß", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChatError("Ungültiges JSON", 400);
  }
}

createServer(async (req, res) => {
  if (!cors(req, res)) return send(res, 403, { error: "Origin nicht erlaubt" });
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/chat") return send(res, 404, { error: "Nicht gefunden" });

  try {
    const body = (await readJson(req)) as ChatRequest;
    send(res, 200, await agent.handle(body));
  } catch (e) {
    if (e instanceof ChatError) return send(res, e.status, { error: e.message });
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: "KI ist gerade ausgelastet, bitte gleich erneut versuchen." });
    if (e instanceof Anthropic.APIError) {
      console.error("Claude API:", e.status, e.message);
      return send(res, 502, { error: "Fehler beim KI-Dienst" });
    }
    console.error(e);
    send(res, 500, { error: "Interner Fehler" });
  }
}).listen(PORT, () => {
  console.log(`Backend läuft auf :${PORT}, erlaubte Origins: ${ALLOWED_ORIGINS.join(", ") || "(keine)"}`);
});
