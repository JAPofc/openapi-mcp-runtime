import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, executeTool, RequestError, cacheClear } from "../dist/index.js";

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

test("executes GET with path/query params and apiKey auth", async () => {
  cacheClear();
  const hits = [];
  await withServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, raw });
      json(res, 200, { id: 42, url: req.url });
    });
  }, async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "getPetById");

    const result = await executeTool(tool, { petId: 42, verbose: true }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { apiKeys: { apiKey: "secret123" } },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { id: 42, url: "/pets/42?verbose=true" });
    assert.equal(hits[0].method, "GET");
    assert.equal(hits[0].url, "/pets/42?verbose=true");
    assert.equal(hits[0].headers["x-api-key"], "secret123");
  });
});

test("executes POST with a JSON body", async () => {
  cacheClear();
  const hits = [];
  await withServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, raw });
      json(res, 201, { created: true });
    });
  }, async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "createPet");

    const result = await executeTool(tool, { name: "Rex", tag: "dog" }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { apiKeys: { apiKey: "k" } },
    });

    assert.equal(result.status, 201);
    assert.deepEqual(JSON.parse(hits[0].raw), { name: "Rex", tag: "dog" });
    assert.equal(hits[0].headers["content-type"], "application/json");
  });
});

test("caches GET responses", async () => {
  cacheClear();
  let hits = 0;
  await withServer((req, res) => {
    hits++;
    json(res, 200, { hits });
  }, async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "getPetById");
    const ctx = {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { apiKeys: { apiKey: "k" } },
      cacheTtl: 60,
    };

    const first = await executeTool(tool, { petId: 1 }, ctx);
    const second = await executeTool(tool, { petId: 1 }, ctx);

    assert.equal(first.cached, undefined);
    assert.equal(second.cached, true);
    assert.equal(hits, 1);
  });
});

test("returns the status for HTTP errors instead of throwing", async () => {
  cacheClear();
  await withServer((req, res) => json(res, 404, { error: "not found" }), async (baseUrl) => {
    const spec = await loadSpec(fixture("petstore-3.0.json"));
    const runtime = createRuntime(spec, { baseUrl });
    const tool = runtime.tools.find((t) => t.name === "getPetById");

    const result = await executeTool(tool, { petId: 999 }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: { apiKeys: { apiKey: "k" } },
    });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "not found" });
  });
});

test("throws RequestError on connection failure", async () => {
  cacheClear();
  const spec = await loadSpec(fixture("petstore-3.0.json"));
  const runtime = createRuntime(spec, { baseUrl: "http://127.0.0.1:1" });
  const tool = runtime.tools.find((t) => t.name === "getPetById");

  await assert.rejects(
    () =>
      executeTool(tool, { petId: 1 }, {
        baseUrl: "http://127.0.0.1:1",
        security: tool.security,
        securitySchemes: runtime.securitySchemes,
        auth: {},
      }),
    RequestError,
  );
});
