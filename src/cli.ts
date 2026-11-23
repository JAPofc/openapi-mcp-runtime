#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSpec, specLabel } from "./openapi.js";
import { createRuntime, publicTool } from "./tools.js";
import { executeTool } from "./executor.js";
import { createHandler } from "./server.js";
import { startStdioServer } from "./stdio.js";
import { startHttpServer } from "./http.js";
import { generateClient, generateTypes } from "./client.js";
import type { AuthOptions, OAuth2Credential } from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
const VERSION = pkg.version;

const HELP = `openapi-mcp-runtime v${VERSION}
Turn any OpenAPI / Swagger spec into a live MCP server.

Usage:
  openapi-mcp-runtime <spec> [options]
  omcp <spec> [options]

Arguments:
  <spec>                     Path or URL to an OpenAPI (3.0/3.1) or Swagger 2.0 document.

Options:
  --transport <stdio|http>   Transport to serve (default: stdio).
  --port <number>            HTTP port (default: 8787).
  --host <host>              HTTP host (default: 127.0.0.1, use 0.0.0.0 to expose).
  --server <url>             Override the server URL from the spec.
  --header <NAME=VALUE>      Extra header, repeatable. \${ENV_VAR} is expanded.
  --bearer <token>           Bearer token for http/bearer security schemes.
  --basic <USER:PASS>        Basic auth credentials.
  --api-key <NAME=VALUE>     Value for an apiKey security scheme, repeatable.
  --oauth2 <SCHEME=ID:SECRET> OAuth2 client credentials, repeatable.
  --scope <SCHEME=a,b>       OAuth2 scopes, repeatable.
  --cache-ttl <seconds>      Cache GET responses for N seconds (default: 0).
  --timeout <ms>             Request timeout in milliseconds (default: 30000).
  --print-tools              Print the generated MCP tools as JSON and exit.
  --generate-types <file>    Write TypeScript tool argument types to <file> and exit.
  --generate-client <file>   Write a self-contained TypeScript client to <file> and exit.
  --verbose                  Log more detail to stderr.
  -h, --help                 Show this help.
  -V, --version              Show the version.

Examples:
  omcp ./petstore.yaml
  omcp https://api.example.com/openapi.json --transport http --port 8787
  omcp ./api.yaml --bearer "$TOKEN" --cache-ttl 60
  omcp ./api.yaml --print-tools
`;

interface CliOptions {
  spec?: string;
  transport: "stdio" | "http";
  port: number;
  host: string;
  headers: Record<string, string>;
  bearer?: string;
  basic?: { username: string; password: string };
  apiKeys: Record<string, string>;
  oauth2: Record<string, OAuth2Credential>;
  cacheTtl: number;
  timeout: number;
  server?: string;
  printTools: boolean;
  generateTypesFile?: string;
  generateClientFile?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    transport: "stdio",
    port: 8787,
    host: "127.0.0.1",
    headers: {},
    apiKeys: {},
    oauth2: {},
    cacheTtl: 0,
    timeout: 30_000,
    printTools: false,
    verbose: false,
    help: false,
    version: false,
  };

  const positional: string[] = [];
  const scopes: Record<string, string[]> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      return value;
    };

    switch (arg) {
      case "--transport":
        options.transport = next() as "stdio" | "http";
        if (options.transport !== "stdio" && options.transport !== "http") {
          throw new Error(`Invalid --transport "${options.transport}" (expected stdio or http).`);
        }
        break;
      case "--port":
        options.port = Number(next());
        if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
          throw new Error(`Invalid --port "${argv[i]}".`);
        }
        break;
      case "--host":
        options.host = next();
        break;
      case "--server":
        options.server = next();
        break;
      case "--header": {
        const [name, ...rest] = next().split("=");
        if (!name || rest.length === 0) throw new Error(`Invalid --header "${argv[i]}" (expected NAME=VALUE).`);
        options.headers[name] = expandEnv(rest.join("="));
        break;
      }
      case "--bearer":
        options.bearer = expandEnv(next());
        break;
      case "--basic": {
        const [username, ...rest] = next().split(":");
        if (!username || rest.length === 0) throw new Error(`Invalid --basic "${argv[i]}" (expected USER:PASS).`);
        options.basic = { username, password: expandEnv(rest.join(":")) };
        break;
      }
      case "--api-key": {
        const [name, ...rest] = next().split("=");
        if (!name || rest.length === 0) throw new Error(`Invalid --api-key "${argv[i]}" (expected NAME=VALUE).`);
        options.apiKeys[name] = expandEnv(rest.join("="));
        break;
      }
      case "--oauth2": {
        const raw = next();
        const eq = raw.indexOf("=");
        const scheme = raw.slice(0, eq);
        const [clientId, ...secretParts] = raw.slice(eq + 1).split(":");
        if (!scheme || !clientId) throw new Error(`Invalid --oauth2 "${raw}" (expected SCHEME=CLIENT_ID:SECRET).`);
        options.oauth2[scheme] = { clientId, clientSecret: secretParts.join(":") || undefined };
        break;
      }
      case "--scope": {
        const raw = next();
        const [scheme, ...rest] = raw.split("=");
        if (!scheme || rest.length === 0) throw new Error(`Invalid --scope "${raw}" (expected SCHEME=a,b).`);
        scopes[scheme] = rest.join("=").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      }
      case "--cache-ttl":
        options.cacheTtl = Number(next());
        if (!Number.isFinite(options.cacheTtl) || options.cacheTtl < 0) throw new Error(`Invalid --cache-ttl "${argv[i]}".`);
        break;
      case "--timeout":
        options.timeout = Number(next());
        if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error(`Invalid --timeout "${argv[i]}".`);
        break;
      case "--print-tools":
        options.printTools = true;
        break;
      case "--generate-types":
        options.generateTypesFile = next();
        break;
      case "--generate-client":
        options.generateClientFile = next();
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-V":
      case "--version":
        options.version = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`);
  options.spec = positional[0];

  for (const [scheme, list] of Object.entries(scopes)) {
    if (options.oauth2[scheme]) options.oauth2[scheme].scopes = list;
  }

  return options;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, b) => {
    const name = a ?? b;
    const found = process.env[name];
    if (found === undefined) throw new Error(`Environment variable ${name} is not set.`);
    return found;
  });
}

function buildAuth(options: CliOptions): AuthOptions {
  return {
    headers: options.headers,
    bearer: options.bearer,
    basic: options.basic,
    apiKeys: options.apiKeys,
    oauth2: options.oauth2,
  };
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n\n${HELP}`);
    process.exit(1);
  }

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!options.spec) {
    process.stderr.write(`Error: missing <spec> (OpenAPI/Swagger file or URL).\n\n${HELP}`);
    process.exit(1);
  }

  const spec = await loadSpec(options.spec);
  const runtime = createRuntime(spec, { baseUrl: options.server });
  const auth = buildAuth(options);

  const log = (message: string) => process.stderr.write(`[openapi-mcp] ${message}\n`);

  if (options.printTools) {
    process.stdout.write(`${JSON.stringify(runtime.tools.map(publicTool), null, 2)}\n`);
    return;
  }
  if (options.generateTypesFile) {
    await writeFile(options.generateTypesFile, generateTypes(runtime.tools), "utf8");
    log(`Wrote tool types to ${options.generateTypesFile}`);
    return;
  }
  if (options.generateClientFile) {
    await writeFile(options.generateClientFile, generateClient(runtime), "utf8");
    log(`Wrote client to ${options.generateClientFile}`);
    return;
  }

  const byName = new Map(runtime.tools.map((tool) => [tool.name, tool]));
  const handler = createHandler({
    tools: runtime.tools,
    serverInfo: { name: "openapi-mcp-runtime", version: VERSION },
    instructions: `MCP server generated from ${options.spec}. Tools map 1:1 to the API operations.`,
    execute: (name, args) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return executeTool(tool, args, {
        baseUrl: runtime.baseUrl,
        auth,
        cacheTtl: options.cacheTtl,
        timeout: options.timeout,
        security: tool.security,
        securitySchemes: runtime.securitySchemes,
      });
    },
  });

  log(`Loaded ${specLabel(spec)} from ${options.spec} — ${runtime.tools.length} tool(s) exposed.`);
  log(`Base URL: ${runtime.baseUrl}`);
  if (options.cacheTtl > 0) log(`GET cache TTL: ${options.cacheTtl}s`);
  if (options.verbose) log(`Auth: ${JSON.stringify(redact(auth))}`);

  if (options.transport === "stdio") {
    log("Transport: stdio (JSON-RPC over stdin/stdout)");
    startStdioServer(handler);
    return;
  }

  const running = await startHttpServer(handler, { port: options.port, host: options.host });
  log(`Transport: HTTP — MCP endpoint ${running.url}`);
  log(`Health check: http://${options.host}:${running.port}/health`);

  const shutdown = () => {
    running.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function redact(auth: AuthOptions): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  if (auth.headers) clone.headers = Object.fromEntries(Object.keys(auth.headers).map((k) => [k, "***"]));
  if (auth.bearer) clone.bearer = "***";
  if (auth.basic) clone.basic = "***";
  if (auth.apiKeys) clone.apiKeys = Object.fromEntries(Object.keys(auth.apiKeys).map((k) => [k, "***"]));
  if (auth.oauth2) clone.oauth2 = Object.fromEntries(Object.keys(auth.oauth2).map((k) => [k, "***"]));
  return clone;
}

main().catch((err: any) => {
  process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
