# AI Planning Assistant (SAC Custom Widget)

Chat-Widget für SAP Analytics Cloud, das Fragen zu Planungsdaten beantwortet und freigegebene Datenaktionen nach Bestätigung auslöst.

## Aufbau

| Datei | Zweck |
|---|---|
| `ai-planning-assistant.json` | Widget-Metadaten: Properties, Skript-Methoden, Events, Data Binding |
| `main.js` | Web Component: Chat-UI, Lesen über das Data Binding, Agent-Loop zum Backend, Bestätigungskarten |
| `action-catalog.example.json` | Beispiel für freigegebene Aktionen (Property `actionCatalog`) |
| `story-script/` | Vorlagen für die Story-Skripte (`onActionRequested`, `onDataRefreshRequested`, `onInitialization`) |
| `dev/` | Lokale Testseite mit simuliertem Data Binding und Story-Skript |

## Rollen

- **Widget:** liest nur. Abfragen laufen über das eigene Data Binding mit den Rechten des Nutzers.
- **Story-Skript:** schreibt. Es führt nur Aktionen aus seiner Whitelist aus (Data Actions, Multi Actions, `submitData`) und meldet das Ergebnis über `setActionResult()` zurück.
- **Backend:** hält das LLM und die API-Keys, siehe [`../../backend`](../../backend). Das Widget kennt nur die URL.

## Ablauf einer Aktion

1. Das Backend antwortet mit einem Tool-Call `propose_action`.
2. Das Widget zeigt eine Bestätigungskarte mit allen Parametern.
3. Nach „Ausführen“ feuert es `onActionRequested`.
4. Das Story-Skript liest `getPendingActionId()` / `getPendingParam(name)` und führt aus.
5. `setActionResult(id, success, message)` schließt die Schleife; das Widget meldet das Ergebnis ans Backend und feuert `onDataRefreshRequested`.

## Backend-Vertrag (`POST {backendUrl}/chat`)

Request:

```json
{
  "sessionId": "…UUID pro Widget-Instanz…",
  "messages": [{ "role": "user", "content": "Wie ist der Umsatz für PC 1000?" }],
  "context": { "model": {...}, "members": {...}, "runtime": {...}, "actions": [...], "notes": [...], "locale": "de-DE" },
  "toolResult": null
}
```

`toolResult` ist nach einem Tool-Call `{ "call": {id, name, arguments}, "output": {...} }`.

Response, eine von:

```json
{ "type": "message", "text": "Der geplante Umsatz beträgt …" }
{ "type": "tool_call", "id": "c1", "name": "query_data", "arguments": { "filters": { "ProfitCenter": "PC_1000" }, "groupBy": ["Date"], "measures": ["Umsatz"] } }
{ "type": "tool_call", "id": "c2", "name": "get_context", "arguments": {} }
{ "type": "tool_call", "id": "c3", "name": "propose_action", "arguments": { "actionId": "DISTRIBUTE_TO_PERIOD", "params": { "Anteil": 0.8 }, "summary": "…" } }
```

Das Widget ruft mit `credentials: "include"` auf. Das Backend muss deshalb CORS für die SAC-Origin des Tenants erlauben (`Access-Control-Allow-Origin: https://<tenant>…`, `Access-Control-Allow-Credentials: true`, Preflight für `Content-Type: application/json`). Ein Wildcard-Origin funktioniert damit nicht.

Ohne `backendUrl` läuft das Widget im **Demo-Modus**: Es erkennt Member-Namen in der Frage und summiert die gebundenen Kennzahlen; bei „verteile/kopiere/Aktion“ zeigt es die erste Aktion des Katalogs.

## Lokal testen

```bash
cd widgets/ai-planning-assistant
python3 -m http.server 8080   # oder: npx serve .
# http://localhost:8080/dev/ öffnen
```

## In SAC einbinden

1. In `ai-planning-assistant.json` bei `webcomponents[0].url` die gehostete URL von `main.js` eintragen, oder die Datei beim Upload in SAC hosten lassen.
2. SAC → Custom Widgets → JSON hochladen.
3. In einer optimierten Story einfügen, im Builder an das Planungsmodell binden, `actionCatalog` setzen.
4. Data Actions/Multi Actions als technische Objekte anlegen und die Skripte aus `story-script/` übernehmen.

Für produktive Nutzung `ignoreIntegrity` auf `false` setzen und den SHA256-Hash in `integrity` hinterlegen.

## Offene Punkte

- Methoden- und Enum-Namen der Story-Skripte gegen die Scripting-Referenz des Tenants prüfen.
- Die gebundene Ergebnismenge ist begrenzt; für Member außerhalb der aktuellen Sicht später Filter über die DataSource-API setzen.
