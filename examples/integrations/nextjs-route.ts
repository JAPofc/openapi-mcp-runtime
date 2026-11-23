// Next.js App Router route handler: app/api/mcp/route.ts
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

export async function POST(request: Request) {
  const message = await request.json();
  const response = await handler(message);
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response);
}

export async function GET() {
  return Response.json({ ok: true, tools: runtime.tools.length });
}
