// Express server exposing an MCP endpoint.
// Run: npx tsx examples/integrations/express.ts
import express from "express";
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

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const response = await handler(req.body);
  if (response === null) {
    res.status(202).end();
    return;
  }
  res.json(response);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`MCP endpoint: http://127.0.0.1:${port}/mcp`));
