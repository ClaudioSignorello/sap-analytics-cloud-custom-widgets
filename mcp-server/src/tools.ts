import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SacClient, SacError, factDataPath } from "./sacClient.js";

const MAX_TEXT = 20_000;

function ok(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n… (gekürzt)" : text }] };
}

function fail(e: unknown) {
  const msg = e instanceof SacError ? `${e.message} (HTTP ${e.status ?? "?"}) ${e.body?.slice(0, 1000) ?? ""}` : String(e);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

async function safe(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

export function registerTools(server: McpServer, sac: SacClient, opts: { readOnly: boolean }) {
  server.registerTool(
    "sac_list_models",
    {
      title: "Modelle auflisten",
      description: "Listet die Modelle (Provider) auf, die über die SAC Data Export API verfügbar sind.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => safe(() => sac.get("/api/v1/dataexport/administration/Namespaces(NamespaceID='sac')/Providers")),
  );

  server.registerTool(
    "sac_get_model_metadata",
    {
      title: "Modell-Metadaten",
      description: "Liefert die OData-Metadaten eines Modells: Dimensionen, Kennzahlen, Entitäten (FactData, <Dimension>Master).",
      inputSchema: { modelId: z.string().describe("Provider-ID des Modells aus sac_list_models") },
      annotations: { readOnlyHint: true },
    },
    ({ modelId }) => safe(() => sac.get(`/api/v1/dataexport/providers/sac/${encodeURIComponent(modelId)}/$metadata`, "application/xml")),
  );

  server.registerTool(
    "sac_query_fact_data",
    {
      title: "Plan-/Ist-Daten abfragen",
      description:
        "Fragt Fact-Daten eines Modells per OData ab. Filter in OData-Syntax, z. B. \"Version eq 'public.Plan' and ProfitCenter eq 'PC_1000'\". " +
        "Ergebnisse sind auf Zeilenebene; für Summen gezielt filtern und auswählen.",
      inputSchema: {
        modelId: z.string(),
        select: z.array(z.string()).optional().describe("Spalten, z. B. ['ProfitCenter','Date','SignedData']"),
        filter: z.string().optional().describe("OData-$filter"),
        orderby: z.string().optional(),
        top: z.number().int().min(1).max(5000).optional().describe("Max. Zeilen, Standard 200"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ modelId, ...q }) => safe(() => sac.get(factDataPath(modelId, q))),
  );

  server.registerTool(
    "sac_get_master_data",
    {
      title: "Stammdaten einer Dimension",
      description: "Liefert Member einer Dimension (Entität <Dimension>Master), z. B. alle Profitcenter mit Beschreibung.",
      inputSchema: {
        modelId: z.string(),
        dimension: z.string().describe("Technischer Dimensionsname, z. B. ProfitCenter"),
        top: z.number().int().min(1).max(5000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ modelId, dimension, top }) =>
      safe(() => sac.get(`/api/v1/dataexport/providers/sac/${encodeURIComponent(modelId)}/${encodeURIComponent(dimension)}Master?$top=${top ?? 500}`)),
  );

  server.registerTool(
    "sac_list_stories",
    {
      title: "Stories auflisten",
      description: "Listet Stories inkl. verwendeter Modelle auf, um zu beantworten, wo welche Daten genutzt werden.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => safe(() => sac.get("/api/v1/stories?include=models")),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "sac_run_multi_action",
    {
      title: "Multi Action ausführen",
      description:
        "Startet eine Multi Action in SAC (ändert Planungsdaten!). Vorher dem Nutzer zusammenfassen, was passiert, und Bestätigung einholen.",
      inputSchema: {
        multiActionId: z.string().describe("ID der Multi Action, wie in SAC angezeigt"),
        parameterValues: z
          .array(z.object({ parameterId: z.string(), value: z.string() }))
          .default([])
          .describe("Parameter der Multi Action"),
      },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    ({ multiActionId, parameterValues }) =>
      safe(() => sac.post(`/api/v1/multiActions/${encodeURIComponent(multiActionId)}/executions`, { parameterValues })),
  );

  server.registerTool(
    "sac_get_multi_action_status",
    {
      title: "Status einer Multi-Action-Ausführung",
      description: "Fragt den Status einer zuvor gestarteten Multi-Action-Ausführung ab.",
      inputSchema: { multiActionId: z.string(), executionId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ multiActionId, executionId }) =>
      safe(() => sac.get(`/api/v1/multiActions/${encodeURIComponent(multiActionId)}/executions/${encodeURIComponent(executionId)}`)),
  );
}
