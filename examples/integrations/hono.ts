// Minimal Hono server exposing an MCP endpoint.
// Run: npx tsx examples/integrations/hono.ts
import { Hono } from "hono";
import { createHandler, createRuntime, executeTool, loadSpec } from "openapi-mcp-runtime";

const spec = await loadSpec(process.env.SPEC ?? "./examples/petstore.yaml");
const runtime = createRuntime(spec);

const handler = createHandler({
  tools: runtime.tools,
  execute: (name, args) => {
    const tool = runtime.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return executeTool(tool, args, {
      baseUrl: runtime.baseUrl,
      security: tool.security,
      securitySchemes: runtime.securitySchemes,
    });
  },
});

const app = new Hono();

app.post("/mcp", async (context) => {
  const message = await context.req.json();
  const response = await handler(message);
  if (response === null) return new Response(null, { status: 202 });
  return context.json(response);
});

app.get("/health", (context) => context.json({ ok: true }));

export default app;
