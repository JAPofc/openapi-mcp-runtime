import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, createHandler, startHttpServer } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, "fixtures", name);

async function makeHandler() {
  const spec = await loadSpec(fixture("petstore-3.0.json"));
  const runtime = createRuntime(spec, { baseUrl: "http://example.test" });
  return createHandler({
    tools: runtime.tools,
    execute: async (name, args) => ({
      url: "http://example.test",
      method: "GET",
      status: 200,
      headers: {},
      body: { ok: true, name, args },
      text: "",
      durationMs: 1,
    }),
  });
}

test("initialize negotiates the protocol version", async () => {
  const handler = await makeHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(response.result.protocolVersion, "2024-11-05");
  assert.ok(response.result.serverInfo.name);
  assert.ok(response.result.capabilities.tools);
});

test("initialize falls back to the latest protocol version", async () => {
  const handler = await makeHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  assert.equal(response.result.protocolVersion, "2025-06-18");
});

test("tools/list returns the generated tools", async () => {
  const handler = await makeHandler();
  const response = await handler({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(response.result.tools.length, 3);
  assert.ok(response.result.tools[0].inputSchema);
});

test("tools/call dispatches and formats the result", async () => {
  const handler = await makeHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "getPetById", arguments: { petId: 7 } },
  });
  assert.equal(response.result.isError, false);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.args.petId, 7);
});

test("tools/call rejects unknown tools", async () => {
  const handler = await makeHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "nope" },
  });
  assert.equal(response.error.code, -32602);
});

test("notifications get no response", async () => {
  const handler = await makeHandler();
  const response = await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(response, null);
});

test("HTTP transport answers JSON-RPC POST and health checks", async () => {
  const handler = await makeHandler();
  const running = await startHttpServer(handler, { port: 0, host: "127.0.0.1" });
  try {
    const init = await fetch(running.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    });
    assert.equal(init.status, 200);
    const initBody = await init.json();
    assert.equal(initBody.result.protocolVersion, "2025-06-18");

    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    assert.deepEqual(await health.json(), { ok: true, transport: "http" });

    const sse = await fetch(`http://127.0.0.1:${running.port}/mcp`);
    assert.match(sse.headers.get("content-type"), /text\/event-stream/);
    await sse.body.cancel();
  } finally {
    await running.close();
  }
});
