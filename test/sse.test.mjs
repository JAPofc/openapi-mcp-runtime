import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, createRuntime, createHandler, startSseServer } from "../dist/index.js";

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

function sseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return {
    async readUntil(predicate) {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (predicate(buffer)) return buffer;
      }
      return buffer;
    },
    cancel: () => reader.cancel(),
  };
}

test("legacy SSE transport: endpoint handshake and tools/call over the stream", async () => {
  const handler = await makeHandler();
  const running = await startSseServer(handler, { port: 0, host: "127.0.0.1" });
  try {
    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    assert.deepEqual(await health.json(), { ok: true, transport: "sse" });

    const stream = await fetch(running.url);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    const reader = sseReader(stream);

    const hello = await reader.readUntil((buffer) => buffer.includes("event: endpoint"));
    const endpoint = hello.match(/data: (\/message\?sessionId=[^\n]+)/)?.[1];
    assert.ok(endpoint, "endpoint event received");

    const post = await fetch(`http://127.0.0.1:${running.port}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "getPetById", arguments: { petId: 3 } },
      }),
    });
    assert.equal(post.status, 200);

    const reply = await reader.readUntil((buffer) => buffer.includes("event: message"));
    const payload = JSON.parse(reply.match(/data: (\{[\s\S]*\})/)[1]);
    assert.equal(payload.result.isError, false);
    assert.equal(JSON.parse(payload.result.content[0].text).args.petId, 3);

    await reader.cancel();
  } finally {
    await running.close();
  }
});

test("legacy SSE rejects messages with an unknown session", async () => {
  const handler = await makeHandler();
  const running = await startSseServer(handler, { port: 0, host: "127.0.0.1" });
  try {
    const res = await fetch(`http://127.0.0.1:${running.port}/message?sessionId=nope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await running.close();
  }
});
