/**
 * Minimaler Client für die öffentlichen SAC-REST-APIs.
 * Authentifizierung: OAuth 2.0 Client Credentials (OAuth-Client aus SAC > App Integration).
 * Schreibende Aufrufe brauchen zusätzlich ein CSRF-Token samt Session-Cookies.
 */
export interface SacConfig {
  tenantUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export class SacError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
  }
}

type FetchFn = typeof fetch;

export class SacClient {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: SacConfig, private readonly fetchFn: FetchFn = fetch) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SacClient {
    const missing = ["SAC_TENANT_URL", "SAC_TOKEN_URL", "SAC_CLIENT_ID", "SAC_CLIENT_SECRET"].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
    return new SacClient({
      tenantUrl: env.SAC_TENANT_URL!.replace(/\/$/, ""),
      tokenUrl: env.SAC_TOKEN_URL!,
      clientId: env.SAC_CLIENT_ID!,
      clientSecret: env.SAC_CLIENT_SECRET!,
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchFn(this.config.tokenUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new SacError("OAuth-Token konnte nicht geholt werden", res.status, await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.accessToken()}`, "x-sap-sac-custom-auth": "true", ...extra };
  }

  async get(path: string, accept = "application/json"): Promise<unknown> {
    const res = await this.fetchFn(this.config.tenantUrl + path, { headers: await this.headers({ Accept: accept }) });
    const text = await res.text();
    if (!res.ok) throw new SacError(`GET ${path} fehlgeschlagen`, res.status, text);
    return accept.includes("json") ? JSON.parse(text) : text;
  }

  /** POST mit CSRF-Token: erst GET /api/v1/csrf mit "x-csrf-token: fetch", Cookies mitschicken. */
  async post(path: string, body: unknown): Promise<unknown> {
    const csrfRes = await this.fetchFn(this.config.tenantUrl + "/api/v1/csrf", {
      headers: await this.headers({ "x-csrf-token": "fetch" }),
    });
    const csrf = csrfRes.headers.get("x-csrf-token");
    if (!csrf) throw new SacError("Kein CSRF-Token erhalten", csrfRes.status);
    const cookies = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    const res = await this.fetchFn(this.config.tenantUrl + path, {
      method: "POST",
      headers: await this.headers({ "x-csrf-token": csrf, Cookie: cookies, "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new SacError(`POST ${path} fehlgeschlagen`, res.status, text);
    return text ? JSON.parse(text) : {};
  }
}

/** Baut eine OData-Abfrage auf die Fact-Daten eines Modells (Data Export API). */
export function factDataPath(modelId: string, opts: { select?: string[]; filter?: string; top?: number; orderby?: string }): string {
  const params = new URLSearchParams();
  if (opts.select?.length) params.set("$select", opts.select.join(","));
  if (opts.filter) params.set("$filter", opts.filter);
  if (opts.orderby) params.set("$orderby", opts.orderby);
  params.set("$top", String(Math.min(opts.top ?? 200, 5000)));
  return `/api/v1/dataexport/providers/sac/${encodeURIComponent(modelId)}/FactData?${params.toString().replace(/\+/g, "%20")}`;
}
