# Backend für den AI Planning Assistant

Hält das LLM (Claude) und die API-Keys. Das Widget kennt nur die URL dieses Backends.

## Ablauf

Die Werkzeuge laufen nicht hier, sondern im Browser. Dort gelten die SAC-Rechte des Nutzers.

1. Das Widget schickt `POST /chat` mit der Frage und dem Story-Kontext (gebundene Dimensionen, Member, Filter, Aktionskatalog).
2. Das Backend fragt Claude. Will Claude ein Werkzeug nutzen, gibt es den Aufruf als `tool_call` ans Widget zurück.
3. Das Widget führt `query_data` / `get_context` lokal aus, `propose_action` erst nach Bestätigung über das Story-Skript, und schickt das Ergebnis als `toolResult` zurück.
4. Das wiederholt sich, bis Claude mit Text antwortet.

Der Gesprächsverlauf liegt pro `sessionId` im Speicher (1 Stunde TTL) und wird nur angehängt, nie umgeschrieben. Den Request/Response-Vertrag beschreibt [`../widgets/ai-planning-assistant/README.md`](../widgets/ai-planning-assistant/README.md).

## Modell und API-Einstellungen

- Modell: `claude-opus-5-5` (über `CLAUDE_MODEL` änderbar), Effort `medium` (`CLAUDE_EFFORT`)
- Strict-Tool-Schemas, höchstens ein Tool-Aufruf pro Antwort
- Prompt-Caching (automatisch) für System-Prompt, Tools und Verlauf
- Server-seitige Refusal-Fallbacks (`fallbacks: "default"`, Beta `server-side-fallback-2026-07-01`): Lehnt das Modell eine Anfrage ab, beantwortet automatisch ein Fallback-Modell. Abschalten lässt sich das in `src/agent.ts`.

## Starten

```bash
cd backend
npm install
npm test
npm run build
ANTHROPIC_API_KEY=… ALLOWED_ORIGINS=https://mein-tenant.eu10.hcs.cloud.sap npm start
```

Danach in der Story `AIPlanningAssistant_1.setBackendUrl("https://…")` setzen oder die Property `backendUrl` im Builder pflegen.

## Sicherheit und Betrieb

- **CORS:** Nur Origins aus `ALLOWED_ORIGINS` werden bedient, mit Credentials. Andere Origins bekommen 403.
- **Keine Nutzer-Authentifizierung im Prototyp:** Für den produktiven Einsatz gehört das Backend hinter XSUAA/IAS (gleicher IdP wie SAC) oder einen API-Gateway mit SSO.
- **Datenschutz:** An Claude gehen die Frage, der Story-Kontext (Metadaten, bis zu 30 Member je Dimension) und die aggregierten Abfrageergebnisse, keine Rohdaten der ganzen Tabelle. Vor dem Kundeneinsatz Auftragsverarbeitung und Region klären; alternativ Claude über Amazon Bedrock oder Google Vertex AI anbinden (eigener Client in `src/server.ts`).
- **Sessions im Speicher:** Für mehrere Instanzen auf Redis o. Ä. umstellen.
