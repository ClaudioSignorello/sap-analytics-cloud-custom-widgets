import { test } from "node:test";
import assert from "node:assert/strict";
import { SacClient, factDataPath } from "../sacClient.js";

const config = { tenantUrl: "https://t.example", tokenUrl: "https://auth.example/oauth/token", clientId: "id", clientSecret: "secret" };

test("factDataPath baut OData-Abfrage", () => {
  const p = factDataPath("MODEL1", { select: ["ProfitCenter", "SignedData"], filter: "Version eq 'public.Plan'", top: 10 });
  assert.equal(p, "/api/v1/dataexport/providers/sac/MODEL1/FactData?%24select=ProfitCenter%2CSignedData&%24filter=Version%20eq%20%27public.Plan%27&%24top=10");
});

test("factDataPath begrenzt $top", () => {
  assert.match(factDataPath("M", { top: 99999 }), /%24top=5000$/);
});

test("post holt Token und CSRF und schickt Cookies mit", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    if (url.endsWith("/api/v1/csrf")) {
      const h = new Headers({ "x-csrf-token": "csrf123" });
      h.append("set-cookie", "JSESSIONID=abc; Path=/; HttpOnly");
      return new Response(null, { headers: h });
    }
    return new Response(JSON.stringify({ executionId: "E1" }));
  }) as typeof fetch;

  const sac = new SacClient(config, fakeFetch);
  const res = await sac.post("/api/v1/multiActions/MA1/executions", { parameterValues: [] });
  assert.deepEqual(res, { executionId: "E1" });

  const exec = calls.at(-1)!;
  const headers = exec.init!.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers["x-csrf-token"], "csrf123");
  assert.equal(headers.Cookie, "JSESSIONID=abc");
  assert.equal(calls.filter((c) => c.url.endsWith("/oauth/token")).length, 1);
});

test("fromEnv meldet fehlende Variablen", () => {
  assert.throws(() => SacClient.fromEnv({}), /SAC_TENANT_URL/);
});
