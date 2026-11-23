// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import type { ExecuteResult, McpTool } from "./types.js";
import { publicTool } from "./tools.js";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const MAX_TEXT_LENGTH = 200_000;

export type MessageHandler = (message: any) => Promise<any | null>;

export interface HandlerOptions {
  tools: McpTool[];
  execute: (name: string, args: Record<string, any>) => Promise<ExecuteResult>;
  serverInfo?: { name: string; version: string };
  instructions?: string;
}

/** Create a JSON-RPC 2.0 message handler implementing the MCP protocol. */
export function createHandler(options: HandlerOptions): MessageHandler {
  const tools = options.tools.map(publicTool);
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const serverInfo = options.serverInfo ?? { name: "openapi-mcp-runtime", version: "0.1.0" };

  return async function handle(message: any): Promise<any | null> {
    if (Array.isArray(message)) {
      const responses = [];
      for (const item of message) {
        const response = await handleSingle(item);
        if (response !== null) responses.push(response);
      }
      return responses.length ? responses : null;
    }
    return handleSingle(message);

    async function handleSingle(msg: any): Promise<any | null> {
      const id = msg?.id;
      const isNotification = id === undefined || id === null;

      if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        if (isNotification) return null;
        return error(id, -32600, "Invalid Request: expected JSON-RPC 2.0 message.");
      }

      const method: string = msg.method;
      const params: any = msg.params ?? {};

      let result: any;
      try {
        switch (method) {
          case "initialize": {
            const requested = params.protocolVersion;
            const protocolVersion =
              typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
                ? requested
                : LATEST_PROTOCOL_VERSION;
            result = {
              protocolVersion,
              capabilities: { tools: { listChanged: false } },
              serverInfo,
              ...(options.instructions ? { instructions: options.instructions } : {}),
            };
            break;
          }
          case "ping":
            result = {};
            break;
          case "tools/list":
            result = { tools };
            break;
          case "tools/call": {
            if (typeof params.name !== "string" || !byName.has(params.name)) {
              return error(id, -32602, `Unknown tool: ${String(params.name)}`);
            }
            const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
            const outcome = await options.execute(params.name, args);
            const text =
              outcome.body !== undefined ? JSON.stringify(outcome.body, null, 2) : outcome.text;
            result = {
              content: [{ type: "text", text: truncate(text) }],
              isError: outcome.status >= 400,
            };
            break;
          }
          case "resources/list":
            result = { resources: [] };
            break;
          case "resources/templates/list":
            result = { resourceTemplates: [] };
            break;
          case "prompts/list":
            result = { prompts: [] };
            break;
          default:
            if (isNotification) return null;
            return error(id, -32601, `Method not found: ${method}`);
        }
      } catch (err: any) {
        if (isNotification) return null;
        const text = err?.result ? `${err.message}\n\n${err.result.text}` : String(err?.message ?? err);
        return error(id, -32603, truncate(text));
      }

      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result };
    }
  };
}

function truncate(text: string): string {
  if (typeof text !== "string") return "";
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}\n… (truncated)` : text;
}

function error(id: any, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
