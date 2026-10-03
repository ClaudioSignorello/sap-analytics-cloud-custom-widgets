# SAC MCP Server

Stellt SAP Analytics Cloud über das [Model Context Protocol](https://modelcontextprotocol.io) als Werkzeugkasten für KI-Assistenten bereit (Claude Desktop, Claude Code, andere MCP-Clients).

## Werkzeuge

| Tool | API | Art |
|---|---|---|
| `sac_list_models` | Data Export API: Provider | lesen |
| `sac_get_model_metadata` | Data Export API: `$metadata` | lesen |
| `sac_query_fact_data` | Data Export API: `FactData` (OData `$select`, `$filter`, `$top`) | lesen |
| `sac_get_master_data` | Data Export API: `<Dimension>Master` | lesen |
| `sac_list_stories` | Content API: `/api/v1/stories` | lesen |
| `sac_run_multi_action` | Multi Actions API: `POST /api/v1/multiActions/{id}/executions` | **schreiben**, nur mit `SAC_READ_ONLY=false` |
| `sac_get_multi_action_status` | Multi Actions API: Ausführungsstatus | lesen, nur mit `SAC_READ_ONLY=false` |

Schreibende Werkzeuge sind standardmäßig ausgeschaltet.

## Voraussetzungen in SAC

- OAuth-Client unter *System → Administration → App Integration* mit Zugriff auf die Data Export API und Multi Actions (Grant: Client Credentials).
- Modelle für den Datenexport freigegeben.
- Der technische Nutzer des OAuth-Clients braucht Leserechte auf die Modelle bzw. Ausführungsrechte auf die Multi Actions. Für nutzerbezogene Rechte später auf Authorization-Code-Flow umstellen.

## Einrichten

```bash
cd mcp-server
npm install
npm run build
cp .env.example .env   # Werte eintragen; .env wird nicht eingecheckt
npm test
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sac": {
      "command": "node",
      "args": ["/pfad/zu/mcp-server/dist/index.js"],
      "env": {
        "SAC_TENANT_URL": "https://mein-tenant.eu10.hcs.cloud.sap",
        "SAC_TOKEN_URL": "https://mein-tenant.authentication.eu10.hana.ondemand.com/oauth/token",
        "SAC_CLIENT_ID": "…",
        "SAC_CLIENT_SECRET": "…",
        "SAC_READ_ONLY": "true"
      }
    }
  }
}
```

## Offene Punkte

- Endpunkte und Antwortformate gegen den eigenen Tenant verifizieren (nur gegen Mocks getestet).
- Aggregation großer Fact-Datenmengen (z. B. `$apply` falls unterstützt, sonst serverseitig summieren).
- HTTP-Transport für den Betrieb auf BTP statt lokal per stdio.
