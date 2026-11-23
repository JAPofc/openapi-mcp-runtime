// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import { createInterface } from "node:readline";
import type { MessageHandler } from "./server.js";

/** Serve MCP over stdio (newline-delimited JSON-RPC). */
export function startStdioServer(handle: MessageHandler): void {
  const rl = createInterface({ input: process.stdin, terminal: false });

  // Serialize handlers so responses keep their order.
  let chain: Promise<void> = Promise.resolve();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    chain = chain.then(async () => {
      let message: any;
      try {
        message = JSON.parse(trimmed);
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
        );
        return;
      }
      const response = await handle(message);
      if (response !== null && response !== undefined) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
