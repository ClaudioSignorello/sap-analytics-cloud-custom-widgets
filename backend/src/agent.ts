import type Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import { TOOLS, toWidgetArguments } from "./tools.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type CreateMessage = (params: CreateParams) => Promise<Anthropic.Beta.BetaMessage>;

/** Request des Widgets (siehe widgets/ai-planning-assistant/README.md). */
export interface ChatRequest {
  sessionId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context?: unknown;
  toolResult?: { call: { id: string; name: string }; output: unknown } | null;
}

export type ChatResponse =
  | { type: "message"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> };

export class ChatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface Session {
  /** Verlauf nur anhängen, nie umschreiben (Thinking-Blöcke bleiben gültig, Cache bleibt warm). */
  messages: MessageParam[];
  pendingToolUseId?: string;
  touchedAt: number;
}

const MAX_CONTEXT_CHARS = 20_000;
const MAX_TOOL_RESULT_CHARS = 30_000;

export interface AgentOptions {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  sessionTtlMs: number;
  maxSessions: number;
}

export class PlanningAgent {
  private sessions = new Map<string, Session>();

  constructor(private readonly createMessage: CreateMessage, private readonly opts: AgentOptions) {}

  async handle(req: ChatRequest): Promise<ChatResponse> {
    if (!req || typeof req.sessionId !== "string" || !req.sessionId) throw new ChatError("sessionId fehlt", 400);
    const session = this.session(req.sessionId);

    if (req.toolResult) {
      if (!session.pendingToolUseId || req.toolResult.call?.id !== session.pendingToolUseId) {
        throw new ChatError("Kein offener Tool-Aufruf mit dieser ID", 409);
      }
      session.messages.push({ role: "user", content: [this.toolResultBlock(session.pendingToolUseId, req.toolResult.output)] });
      session.pendingToolUseId = undefined;
    } else {
      const last = req.messages?.at(-1);
      if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) {
        throw new ChatError("Letzte Nachricht muss eine Nutzernachricht sein", 400);
      }
      const content: ContentBlockParam[] = [];
      if (session.pendingToolUseId) {
        // Nutzer hat weitergeschrieben, ohne die Aktionskarte zu bestätigen
        content.push(this.toolResultBlock(session.pendingToolUseId, { cancelled: true, reason: "Nutzer hat eine neue Frage gestellt" }));
        session.pendingToolUseId = undefined;
      }
      content.push({ type: "text", text: `<sac_context>${truncate(JSON.stringify(req.context ?? {}), MAX_CONTEXT_CHARS)}</sac_context>` });
      content.push({ type: "text", text: last.content });
      session.messages.push({ role: "user", content });
    }

    const response = await this.createMessage({
      model: this.opts.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      output_config: { effort: this.opts.effort },
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: session.messages,
    });
    session.messages.push({ role: "assistant", content: response.content as ContentBlockParam[] });

    return this.toChatResponse(session, response);
  }

  private toChatResponse(session: Session, response: Anthropic.Beta.BetaMessage): ChatResponse {
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    switch (response.stop_reason) {
      case "tool_use": {
        const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (!call) return { type: "message", text: text || "Keine Antwort erhalten." };
        session.pendingToolUseId = call.id;
        return { type: "tool_call", id: call.id, name: call.name, arguments: toWidgetArguments(call.name, call.input) };
      }
      case "refusal":
        return { type: "message", text: "Bei dieser Anfrage kann ich nicht helfen. Formuliere sie bitte anders." };
      case "max_tokens":
        return { type: "message", text: (text ? text + "\n\n" : "") + "(Antwort wurde gekürzt.)" };
      default:
        return { type: "message", text: text || "Keine Antwort erhalten." };
    }
  }

  private toolResultBlock(toolUseId: string, output: unknown): Anthropic.Beta.BetaToolResultBlockParam {
    const isError = !!output && typeof output === "object" && "error" in output;
    return { type: "tool_result", tool_use_id: toolUseId, content: truncate(JSON.stringify(output ?? null), MAX_TOOL_RESULT_CHARS), is_error: isError };
  }

  private session(id: string): Session {
    const now = Date.now();
    for (const [key, s] of this.sessions) if (now - s.touchedAt > this.opts.sessionTtlMs) this.sessions.delete(key);
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= this.opts.maxSessions) {
        const oldest = [...this.sessions].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (oldest) this.sessions.delete(oldest[0]);
      }
      s = { messages: [], touchedAt: now };
      this.sessions.set(id, s);
    }
    s.touchedAt = now;
    return s;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…(gekürzt)" : s;
}
