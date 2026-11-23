// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

/** Shared types for openapi-mcp-runtime. */

export interface McpTool {
  /** Unique tool name (MCP-safe: [a-zA-Z0-9_-], max 64 chars). */
  name: string;
  description: string;
  /** JSON Schema object describing the tool arguments. */
  inputSchema: any;
  /** MCP annotations (readOnlyHint, destructiveHint, ...). */
  annotations: Record<string, any>;
  /** Uppercase HTTP method. */
  method: string;
  /** Path template, e.g. /pets/{petId}. */
  path: string;
  /** Merged parameters (path-level + operation-level, dereferenced). */
  parameters: any[];
  /** Effective security requirements for this operation. */
  security: any[];
}

export interface OAuth2Credential {
  tokenUrl?: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}

/** Authentication material supplied by the user (CLI flags / programmatic API). */
export interface AuthOptions {
  /** Extra static headers, always sent. */
  headers?: Record<string, string>;
  /** Bearer token (used when a `http bearer` scheme exists). */
  bearer?: string;
  /** Basic auth credentials (used when a `http basic` scheme exists). */
  basic?: { username: string; password: string };
  /** Values for `apiKey` security schemes, keyed by scheme name. */
  apiKeys?: Record<string, string>;
  /** OAuth2 client-credentials config, keyed by scheme name. */
  oauth2?: Record<string, OAuth2Credential>;
}

export interface RuntimeOptions {
  /** Override the server URL from the spec. */
  baseUrl?: string;
  auth?: AuthOptions;
  /** Cache GET responses for this many seconds (0 = off). */
  cacheTtl?: number;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom fetch implementation (testing). */
  fetchFn?: typeof fetch;
}

export interface ExecuteResult {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  body?: any;
  text: string;
  durationMs: number;
  cached?: boolean;
}
