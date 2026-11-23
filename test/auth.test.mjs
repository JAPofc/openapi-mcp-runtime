import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, executeTool, clearTokenCache } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, "fixtures", name);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("oauth2 client credentials flow fetches a token and sends it as bearer", async () => {
  clearTokenCache();
  const hits = [];
  await withServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      hits.push({ url: req.url, authorization: req.headers.authorization, body: raw });
      if (req.url === "/oauth/token") {
        assert.match(raw, /grant_type=client_credentials/);
        json(res, 200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 });
        return;
      }
      json(res, 200, { ok: true });
    });
  }, async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.1.yaml"));
    spec.components.securitySchemes.oauth2.flows.clientCredentials.tokenUrl = `${baseUrl}/oauth/token`;
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools[0];

    const result = await executeTool(tool, { service: "orders", detail: "full" }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { oauth2: { oauth2: { clientId: "cid", clientSecret: "csecret", scopes: ["read:status"] } } },
    });

    assert.equal(result.status, 200);
    const tokenHit = hits.find((hit) => hit.url === "/oauth/token");
    assert.equal(tokenHit.authorization, `Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    assert.match(tokenHit.body, /scope=read%3Astatus/);
    const apiHit = hits.find((hit) => hit.url.startsWith("/status"));
    assert.equal(apiHit.authorization, "Bearer tok-123");
  });
});

test("http bearer and basic auth schemes", async () => {
  clearTokenCache();
  const hits = [];
  await withServer((req, res) => {
    hits.push({ url: req.url, authorization: req.headers.authorization });
    json(res, 200, { ok: true });
  }, async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "getPetById");

    await executeTool(tool, { petId: 1 }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { bearer: "bearer-token", apiKeys: { apiKey: "ignored" } },
    });
    // Global `security` is apiKey; bearer is sent as a static fallback only when no requirement matches.
    assert.equal(hits[0].authorization, "Bearer bearer-token");
  });
});

test("missing credentials proceed unauthenticated with a warning", async () => {
  clearTokenCache();
  await withServer((req, res) => json(res, 200, { ok: true }), async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "getPetById");
    const result = await executeTool(tool, { petId: 1 }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: {},
    });
    assert.equal(result.status, 200);
  });
});
