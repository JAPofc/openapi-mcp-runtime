// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/JAPofc/openapi-mcp-runtime

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readBody } from "./http.js";
import type { MessageHandler } from "./server.js";

export interface SseTransportOptions {
  port?: number;
  host?: string;
}

export interface RunningSseServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

interface Session {
  res: import("node:http").ServerResponse;
  keepAlive: NodeJS.Timeout;
}

/**
 * Serve MCP over the legacy HTTP+SSE transport:
 *   GET  /sse                  -> SSE stream, first event is `endpoint`
 *   POST /message?sessionId=.. -> JSON-RPC requests for that session
 */
export async function startSseServer(
  handle: MessageHandler,
  options: SseTransportOptions = {},
): Promise<RunningSseServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const sessions = new Map<string, Session>();

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
      res.end(JSON.stringify({ ok: true, transport: "sse" }));
      return;
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      const sessionId = randomUUID();
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const session: Session = {
        res,
        keepAlive: setInterval(() => res.write(": ping\n\n"), 15_000),
      };
      sessions.set(sessionId, session);
      res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);
      req.on("close", () => {
        clearInterval(session.keepAlive);
        sessions.delete(sessionId);
      });
      return;
    }

    if (url.pathname === "/message" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown session" }));
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
      if (response !== null && response !== undefined) {
        session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
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
    url: `http://${host}:${actualPort}/sse`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
