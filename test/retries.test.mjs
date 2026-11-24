import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, executeTool, cacheClear } from "../dist/index.js";

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

async function makeTool(baseUrl) {
  const spec = await loadSpec(fixture("petstore-3.0.json"));
  const runtime = createRuntime(spec, { baseUrl });
  const tool = runtime.tools.find((candidate) => candidate.name === "getPetById");
  return { runtime, tool };
}

test("retries 5xx responses until success", async () => {
  cacheClear();
  let hits = 0;
  await withServer((req, res) => {
    hits++;
    if (hits <= 2) json(res, 500, { error: "upstream down" });
    else json(res, 200, { ok: true, hits });
  }, async (baseUrl) => {
    const { runtime, tool } = await makeTool(baseUrl);
    const result = await executeTool(tool, { petId: 1 }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: {},
      retries: 2,
      retryDelayMs: 5,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, hits: 3 });
    assert.equal(hits, 3);
  });
});

test("does not retry client errors", async () => {
  cacheClear();
  let hits = 0;
  await withServer((req, res) => {
    hits++;
    json(res, 404, { error: "not found" });
  }, async (baseUrl) => {
    const { runtime, tool } = await makeTool(baseUrl);
    const result = await executeTool(tool, { petId: 1 }, {
      baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
      auth: {},
      retries: 3,
      retryDelayMs: 5,
    });
    assert.equal(result.status, 404);
    assert.equal(hits, 1);
  });
});

test("reports the attempt count when all retries fail", async () => {
  cacheClear();
  const { runtime, tool } = await makeTool("http://127.0.0.1:1");
  await assert.rejects(
    () =>
      executeTool(tool, { petId: 1 }, {
        baseUrl: "http://127.0.0.1:1",
        security: tool.security,
        securitySchemes: runtime.securitySchemes,
        auth: {},
        retries: 1,
        retryDelayMs: 5,
      }),
    /Request failed after 2 attempt\(s\)/,
  );
});
