// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import { resolveAuth } from "./auth.js";
import { cacheGet, cacheSet } from "./cache.js";
import type { ExecuteResult, McpTool, RuntimeOptions } from "./types.js";

export interface ExecuteContext extends RuntimeOptions {
  baseUrl: string;
  security?: any[];
  securitySchemes?: Record<string, any>;
}

/** Raised when the HTTP call itself fails (network / timeout). */
export class RequestError extends Error {
  readonly result: ExecuteResult;
  constructor(message: string, result: ExecuteResult) {
    super(message);
    this.name = "RequestError";
    this.result = result;
  }
}

/** Execute a single tool call: build the request, apply auth, call the API. */
export async function executeTool(
  tool: McpTool,
  args: Record<string, any>,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const started = Date.now();
  const method = tool.method;
  const params = tool.parameters ?? [];

  // 1. Path parameters
  let path = tool.path;
  for (const param of params) {
    if (param?.in !== "path") continue;
    const value = args[param.name];
    if (value === undefined || value === null || value === "") {
      throw new RequestError(
        `Missing required path parameter "${param.name}"`,
        emptyResult(ctx.baseUrl + tool.path, method, started),
      );
    }
    path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
  }

  // 2. Query parameters
  const query = new URLSearchParams();
  for (const param of params) {
    if (param?.in !== "query") continue;
    const value = args[param.name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(param.name, String(item));
    } else {
      query.append(param.name, String(value));
    }
  }

  // 3. Header parameters
  const headerParams: Record<string, string> = {};
  for (const param of params) {
    if (param?.in !== "header") continue;
    const value = args[param.name];
    if (value !== undefined && value !== null) headerParams[param.name] = String(value);
  }

  // 4. Body — either an explicit `body` property or all remaining arguments.
  const hasExplicitBody = tool.inputSchema?.properties && "body" in tool.inputSchema.properties;
  let body: any;
  if (hasExplicitBody) {
    body = args.body;
  } else {
    const consumed = new Set(params.map((p) => p.name));
    const rest: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      if (consumed.has(key) || value === undefined) continue;
      rest[key] = value;
    }
    if (Object.keys(rest).length > 0) body = rest;
  }

  // 5. Auth
  const security = ctx.security ?? [];
  const { headers: authHeaders, query: authQuery, satisfied } = await resolveAuth(
    security,
    ctx.securitySchemes ?? {},
    ctx.auth ?? {},
  );
  if (!satisfied && security.length > 0) {
    process.stderr.write(
      "[openapi-mcp] warning: security requirements could not be satisfied — calling API unauthenticated.\n",
    );
  }
  for (const [key, value] of authQuery) query.append(key, value);

  const url = `${ctx.baseUrl}${path}${query.toString() ? `?${query.toString()}` : ""}`;

  // 6. Headers + body
  const headers: Record<string, string> = { ...authHeaders, ...headerParams };
  const init: RequestInit = { method, headers, redirect: "follow" };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    init.body = JSON.stringify(body);
  }

  // 7. Cache (GET only)
  const cacheKey = `${method} ${url} ${init.body ?? ""} ${headers["authorization"] ?? ""}`;
  const ttl = ctx.cacheTtl ?? 0;
  if (method === "GET" && ttl > 0) {
    const hit = cacheGet(cacheKey);
    if (hit) return { ...hit, durationMs: Date.now() - started, cached: true };
  }

  const fetchFn = ctx.fetchFn ?? fetch;
  const maxAttempts = 1 + Math.max(0, Math.floor(ctx.retries ?? 0));
  const baseDelay = Math.max(0, ctx.retryDelayMs ?? 250);

  let res: Response | null = null;
  let lastError: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(ctx.timeout ?? 30_000) });
      lastError = null;
      if (res.status < 500 || attempt === maxAttempts - 1) break;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) break;
    }
    await sleep(baseDelay * 2 ** attempt);
  }

  if (!res) {
    const reason = lastError?.name === "TimeoutError" ? "timeout" : lastError?.message ?? String(lastError);
    const message = `Request failed after ${maxAttempts} attempt(s): ${reason}`;
    throw new RequestError(
      message,
      { url, method, status: 0, headers: {}, text: message, durationMs: Date.now() - started },
    );
  }

  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const result: ExecuteResult = {
    url,
    method,
    status: res.status,
    headers: responseHeaders,
    body: parsed,
    text,
    durationMs: Date.now() - started,
  };
  if (method === "GET" && ttl > 0) cacheSet(cacheKey, ttl, result);
  return result;
}

function emptyResult(url: string, method: string, started: number): ExecuteResult {
  return { url, method, status: 0, headers: {}, text: "", durationMs: Date.now() - started };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
