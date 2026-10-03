import type Anthropic from "@anthropic-ai/sdk";

/**
 * Werkzeuge, die das Modell aufrufen kann. Ausgeführt werden sie nicht hier,
 * sondern im Widget (Lesen) bzw. nach Bestätigung im Story-Skript (Aktionen).
 * Die Schemas sind strict, deshalb Listen statt freier Objekt-Schlüssel.
 */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "query_data",
    description:
      "Aggregiert die Planungsdaten, an die das Widget gebunden ist, mit den Rechten des Nutzers. " +
      "Für jede Zahl in einer Antwort verwenden. Filter auf Member-IDs oder -Bezeichnungen aus dem Kontext; " +
      "groupBy leer = Gesamtsumme; measures leer = alle gebundenen Kennzahlen. " +
      "Liefert matchedRows=0 und einen Hinweis, wenn nichts passt.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string", description: "Dimensions-ID, z. B. ProfitCenter" },
              members: { type: "array", items: { type: "string" }, description: "Member-IDs oder Bezeichnungen" },
            },
            required: ["dimension", "members"],
            additionalProperties: false,
          },
        },
        groupBy: { type: "array", items: { type: "string" }, description: "Dimensions-IDs für die Aufschlüsselung" },
        measures: { type: "array", items: { type: "string" }, description: "Kennzahl-IDs oder Bezeichnungen" },
      },
      required: ["filters", "groupBy", "measures"],
      additionalProperties: false,
    },
  },
  {
    name: "get_context",
    description:
      "Liest den aktuellen Kontext der Story neu: gebundene Dimensionen/Kennzahlen, Member, aktive Filter, Variablen, " +
      "freigegebene Aktionen und Hinweise aus dem Story-Skript. Nützlich, wenn der Nutzer fragt, warum Daten fehlen.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "propose_action",
    description:
      "Schlägt eine freigegebene Planungsaktion aus dem Aktionskatalog vor. Der Nutzer sieht eine Bestätigungskarte " +
      "mit allen Parametern; erst nach seiner Bestätigung führt die Story die Aktion aus. Das Ergebnis kommt als Tool-Ergebnis zurück " +
      "(success/message oder cancelled). Nur actionIds und Parameter-IDs aus dem Katalog verwenden, Member-Werte als IDs.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        params: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, value: { type: "string" } },
            required: ["id", "value"],
            additionalProperties: false,
          },
        },
        summary: { type: "string", description: "Ein Satz in Fachsprache: was ändert sich wo." },
      },
      required: ["actionId", "params", "summary"],
      additionalProperties: false,
    },
  },
];

type QueryInput = { filters: { dimension: string; members: string[] }[]; groupBy: string[]; measures: string[] };
type ProposeInput = { actionId: string; params: { id: string; value: string }[]; summary: string };

/** Übersetzt die strict-Eingabe des Modells in das Argumentformat des Widgets. */
export function toWidgetArguments(name: string, input: unknown): Record<string, unknown> {
  if (name === "query_data") {
    const q = input as QueryInput;
    return {
      filters: Object.fromEntries(q.filters.map((f) => [f.dimension, f.members])),
      groupBy: q.groupBy,
      measures: q.measures,
    };
  }
  if (name === "propose_action") {
    const p = input as ProposeInput;
    return { actionId: p.actionId, params: Object.fromEntries(p.params.map((x) => [x.id, x.value])), summary: p.summary };
  }
  return {};
}
