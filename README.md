# openapi-mcp-runtime

[![npm](https://img.shields.io/npm/v/openapi-mcp-runtime)](https://www.npmjs.com/package/openapi-mcp-runtime)
[![license](https://img.shields.io/npm/l/openapi-mcp-runtime)](https://github.com/japofc/openapi-mcp-runtime/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/openapi-mcp-runtime)](https://nodejs.org)
[![CI](https://github.com/japofc/openapi-mcp-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/japofc/openapi-mcp-runtime/actions/workflows/ci.yml)

Turn any OpenAPI 3.0, 3.1 or Swagger 2.0 document into a live
[Model Context Protocol](https://modelcontextprotocol.io) server. Every API
operation becomes an agent-callable tool, with authentication, caching and typed
arguments. No wrapper code, no code-generation step.

```bash
npx openapi-mcp-runtime ./petstore.yaml
```

```
[openapi-mcp] Loaded OpenAPI 3.0.3 from ./petstore.yaml — 19 tool(s) exposed.
[openapi-mcp] Base URL: https://petstore3.swagger.io/api/v3
[openapi-mcp] Transport: stdio (JSON-RPC over stdin/stdout)
```

## What it does

`openapi-mcp-runtime` is a **runtime**, not a generator. It loads a spec,
dereferences every `$ref`, and serves tools that proxy the live API.

- Reads OpenAPI 3.0.x, 3.1.x and Swagger 2.0 documents (JSON or YAML), from disk or a URL.
- Serves tools over **stdio** (Claude Desktop, Cursor, CLI agents) or **Streamable HTTP** (remote clients, custom integrations).
- Applies the spec's security: `apiKey` (header/query/cookie), HTTP `bearer`, HTTP `basic`, and OAuth2 client credentials.
- Builds tool arguments from the spec's schemas, so agents get JSON Schema hints for path, query, header and body values.
- Optionally caches `GET` responses for a TTL.
- Ships a CLI and a typed ESM library in one package.

### How it compares

| | `openapi-mcp-runtime` | codegen-only converters |
|---|---|---|
| OpenAPI 3.0 / 3.1 / Swagger 2.0 | yes | often 3.1 only |
| Runs directly, no build step | yes | no |
| apiKey / bearer / basic / OAuth2 | yes | varies |
| GET response caching | yes | rarely |
| stdio + Streamable HTTP | yes | usually stdio |
| Typed client / type generation | yes | yes |

## Install

```bash
npm install -g openapi-mcp-runtime   # global CLI
npm install openapi-mcp-runtime      # library / npx
```

Requires Node.js 18.17 or newer.

## Quickstart

Serve a spec over stdio:

```bash
npx openapi-mcp-runtime ./petstore.yaml
```

Serve it over HTTP:

```bash
npx openapi-mcp-runtime ./petstore.yaml --transport http --port 8787
# MCP endpoint:  http://127.0.0.1:8787/mcp
# Health check:  http://127.0.0.1:8787/health
```

Inspect the tools that would be exposed:

```bash
npx openapi-mcp-runtime ./petstore.yaml --print-tools
```

A sample spec lives in [`examples/petstore.yaml`](examples/petstore.yaml).

## Integrations

Ready-made configurations and framework adapters are in
[`examples/integrations/`](examples/integrations):

| Target | File |
|---|---|
| Claude Desktop | [`claude-desktop.json`](examples/integrations/claude-desktop.json) |
| Cursor | [`cursor.json`](examples/integrations/cursor.json) |
| Hono | [`hono.ts`](examples/integrations/hono.ts) |
| Express | [`express.ts`](examples/integrations/express.ts) |
| Next.js (App Router) | [`nextjs-route.ts`](examples/integrations/nextjs-route.ts) |

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": ["-y", "openapi-mcp-runtime", "./examples/petstore.yaml"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": ["-y", "openapi-mcp-runtime", "./examples/petstore.yaml"]
    }
  }
}
```

## CLI reference

| Option | Description |
|---|---|
| `--transport <stdio\|http>` | Transport to serve (default `stdio`). |
| `--port <number>` | HTTP port (default `8787`). |
| `--host <host>` | HTTP host (default `127.0.0.1`; use `0.0.0.0` to expose). |
| `--server <url>` | Override the server URL from the spec. |
| `--header <NAME=VALUE>` | Extra header, repeatable. `${ENV_VAR}` is expanded. |
| `--bearer <token>` | Bearer token for `http bearer` schemes. |
| `--basic <USER:PASS>` | Basic auth credentials. |
| `--api-key <NAME=VALUE>` | Value for an `apiKey` scheme, repeatable. |
| `--oauth2 <SCHEME=ID:SECRET>` | OAuth2 client credentials, repeatable. |
| `--scope <SCHEME=a,b>` | OAuth2 scopes, repeatable. |
| `--cache-ttl <seconds>` | Cache `GET` responses for N seconds (default `0`). |
| `--timeout <ms>` | Request timeout in milliseconds (default `30000`). |
| `--print-tools` | Print generated tools as JSON and exit. |
| `--generate-types <file>` | Write TypeScript argument types to a file. |
| `--generate-client <file>` | Write a self-contained TypeScript client. |
| `--verbose` | Log more detail to stderr. |
| `-h`, `--help` | Show help. |
| `-V`, `--version` | Show version. |

Logs go to stderr; `--print-tools` writes JSON to stdout.

## Authentication

Credentials are matched to the spec's `securitySchemes` by name. Missing
credentials never abort the server — the request proceeds unauthenticated and
the API decides.

```bash
# apiKey scheme
npx openapi-mcp-runtime ./api.yaml --api-key apiKey=my-secret

# bearer
npx openapi-mcp-runtime ./api.yaml --bearer "$TOKEN"

# basic
npx openapi-mcp-runtime ./api.yaml --basic user:pass

# OAuth2 client credentials (tokenUrl comes from the spec)
npx openapi-mcp-runtime ./api.yaml --oauth2 myOAuth=client-id:client-secret --scope myOAuth=read,write

# static header, environment variable expanded at startup
npx openapi-mcp-runtime ./api.yaml --header "X-Tenant=$TENANT_ID"
```

## Library

```ts
import {
  createHandler,
  createRuntime,
  executeTool,
  loadSpec,
  startHttpServer,
} from "openapi-mcp-runtime";

const spec = await loadSpec("./petstore.yaml"); // file or URL, $refs resolved
const runtime = createRuntime(spec, { baseUrl: "https://api.example.com" });

const tool = runtime.tools.find((candidate) => candidate.name === "listPets");
const result = await executeTool(tool, { limit: 10 }, {
  baseUrl: runtime.baseUrl,
  auth: { bearer: process.env.TOKEN },
  security: tool.security,
  securitySchemes: runtime.securitySchemes,
  cacheTtl: 60,
});

const handler = createHandler({ tools: runtime.tools, execute });
await startHttpServer(handler, { port: 8787 });
```

### Generated types and client

```bash
npx openapi-mcp-runtime ./api.yaml --generate-types ./api-types.ts
npx openapi-mcp-runtime ./api.yaml --generate-client ./api-client.ts
```

```ts
import { callTool } from "./api-client.ts";

const pets = await callTool("listPets", { limit: 10 });
```

## How it works

1. `loadSpec()` parses the document and dereferences every `$ref` (internal, external file, remote).
2. `createRuntime()` walks `paths`; each operation becomes an MCP tool named after its `operationId` (or a generated `method_path` name), with a JSON Schema assembled from path, query, header and body definitions.
3. `createHandler()` implements the MCP JSON-RPC surface: `initialize`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`.
4. `startStdioServer()` or `startHttpServer()` exposes the handler to clients.

Operations can be hidden from MCP with `x-mcp-exclude: true`.

## Development

```bash
npm install
npm test        # build + run the test suite (node:test)
npm run build   # compile TypeScript to dist/
npm run dev     # watch mode
```

The test suite covers the spec parser, tool conversion, request building,
authentication, caching, the MCP protocol, the HTTP transport and the CLI.

## Publishing

Publishing is automated with GitHub Actions (see
[`.github/workflows/publish.yml`](.github/workflows/publish.yml)):

1. Create an npm access token with **Publish** permission and add it as the
   `NPM_TOKEN` repository secret.
2. Push a version tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. CI builds, tests and runs `npm publish --provenance`, then creates a GitHub
   release from the tag.

## Contributing

Issues and pull requests are welcome. Please open an issue before large changes
so the design can be discussed. Keep the test suite green: `npm test`.

## Trademark

The name **japofc** and the project branding are trademarks of japofc. The MIT
license covers the code only and does not grant any rights to the name or
branding. Forks and derivative works must keep the copyright notice and license
text, and must not present themselves as official releases. See
[TRADEMARK.md](TRADEMARK.md).

## License and attribution

MIT License. Copyright (c) 2026 **japofc** — author and maintainer.

Docs: [`docs/index.html`](docs/index.html) · Source: `src/` · Tests: `test/`
