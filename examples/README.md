# Examples

| File | What it shows |
|---|---|
| `petstore.yaml` | Sample OpenAPI 3.0 spec used by the docs and tests. |
| `integrations/claude-desktop.json` | Claude Desktop MCP server config (stdio + HTTP). |
| `integrations/cursor.json` | Cursor `.cursor/mcp.json` config. |
| `integrations/hono.ts` | Mount the MCP endpoint on a Hono server. |
| `integrations/express.ts` | Mount the MCP endpoint on an Express server. |
| `integrations/nextjs-route.ts` | Next.js App Router route handler (`app/api/mcp/route.ts`). |

Quick run:

```bash
npx openapi-mcp-runtime examples/petstore.yaml
npx openapi-mcp-runtime examples/petstore.yaml --transport http --port 8787
npx tsx examples/integrations/hono.ts
```

`SPEC` env var overrides the spec path in the integration examples:

```bash
SPEC=./my-api.yaml npx tsx examples/integrations/hono.ts
```
