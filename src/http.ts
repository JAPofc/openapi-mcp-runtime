// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import { createServer, type Server } from "node:http";
import type { MessageHandler } from "./server.js";

export interface HttpTransportOptions {
  port?: number;
  host?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Serve MCP over the Streamable HTTP transport (POST /mcp, SSE GET /mcp). */
export async function startHttpServer(
  handle: MessageHandler,
  options: HttpTransportOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, transport: "http" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (req.method === "GET") {
      // Streamable HTTP: keep the SSE channel open for server messages.
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const body = await readBody(req);
    let message: any;
    try {
      message = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    const response = await handle(message);
    if (response === null || response === undefined) {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
