// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import { resolveServerUrl, specKind, type SpecDocument } from "./openapi.js";
import type { McpTool } from "./types.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export interface Runtime {
  spec: SpecDocument;
  kind: "openapi3" | "swagger2" | "unknown";
  baseUrl: string;
  tools: McpTool[];
  securitySchemes: Record<string, any>;
  globalSecurity: any[];
}

/** Build a runtime from a (dereferenced) spec document. */
export function createRuntime(spec: SpecDocument, options: { baseUrl?: string } = {}): Runtime {
  const globalSecurity = Array.isArray(spec.security) ? spec.security : [];
  return {
    spec,
    kind: specKind(spec),
    baseUrl: resolveServerUrl(spec, options.baseUrl),
    tools: specToTools(spec, globalSecurity),
    securitySchemes: (spec.components?.securitySchemes ?? spec.securityDefinitions ?? {}) as Record<string, any>,
    globalSecurity,
  };
}

/** Convert every operation in the spec into an MCP tool. */
export function specToTools(spec: SpecDocument, globalSecurity: any[] = []): McpTool[] {
  const tools: McpTool[] = [];
  const nameCounts = new Map<string, number>();

  const paths = (spec.paths ?? {}) as Record<string, any>;
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams: any[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      if (operation["x-mcp-exclude"] === true) continue;

      const tool = operationToTool(method.toUpperCase(), path, operation, pathLevelParams, globalSecurity);
      if (!tool) continue;

      const base = sanitizeName(tool.name);
      const seen = nameCounts.get(base) ?? 0;
      nameCounts.set(base, seen + 1);
      const name = seen === 0 ? base : sanitizeName(`${base}_${seen + 1}`);

      tools.push({ ...tool, name });
    }
  }
  return tools;
}

function operationToTool(
  method: string,
  path: string,
  operation: any,
  pathLevelParams: any[],
  globalSecurity: any[],
): { name: string } & Omit<McpTool, "name"> | null {
  const params = mergeParameters(pathLevelParams, operation.parameters);
  const properties: Record<string, any> = {};
  const required: string[] = [];
  let bodySchema: any = null;
  let bodyRequired = false;

  for (const param of params) {
    if (!param || typeof param !== "object") continue;
    const location: string = param.in;

    if (location === "body") {
      bodySchema = toJsonSchema(param.schema);
      bodyRequired = param.required === true;
      continue;
    }
    if (location === "formData") {
      // Swagger 2.0 form fields behave like JSON body properties for MCP clients.
      bodySchema = bodySchema ?? { type: "object", properties: {} };
      bodySchema.properties = bodySchema.properties ?? {};
      bodySchema.properties[param.name] = toJsonSchema(param);
      if (param.required) bodySchema.required = [...(bodySchema.required ?? []), param.name];
      continue;
    }
    if (location === "cookie") continue; // not exposed as a tool argument

    const schema = param.schema
      ? toJsonSchema(param.schema)
      : toJsonSchema({
          type: param.type,
          format: param.format,
          enum: param.enum,
          items: param.items,
          default: param.default,
          description: param.description,
        });
    properties[param.name] = { ...schema, ...(param.description ? { description: param.description } : {}) };
    if (param.required) required.push(param.name);
  }

  const requestBody = operation.requestBody;
  if (requestBody && typeof requestBody === "object") {
    const content = requestBody.content ?? {};
    const media: any =
      content["application/json"] ?? content["*/*"] ?? Object.values(content)[0];
    const schema = toJsonSchema(media?.schema);
    if (schema && schema.type === "object" && schema.properties) {
      Object.assign(properties, schema.properties);
      for (const r of schema.required ?? []) if (!required.includes(r)) required.push(r);
    } else if (schema && Object.keys(schema).length > 0) {
      properties["body"] = schema;
      if (requestBody.required) required.push("body");
    }
  } else if (bodySchema) {
    if (bodySchema.type === "object" && bodySchema.properties) {
      Object.assign(properties, bodySchema.properties);
      for (const r of bodySchema.required ?? []) if (!required.includes(r)) required.push(r);
    } else if (Object.keys(bodySchema).length > 0) {
      properties["body"] = bodySchema;
      if (bodyRequired) required.push("body");
    }
  }

  const inputSchema = {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };

  const summary: string | undefined = operation.summary;
  const description: string =
    [operation.summary, operation.description].filter(Boolean).join("\n\n").slice(0, 1200) ||
    `${method} ${path}`;

  return {
    name: operation.operationId ?? `${method.toLowerCase()}_${path}`,
    description,
    inputSchema,
    annotations: {
      ...(summary ? { title: summary.slice(0, 100) } : {}),
      readOnlyHint: method === "GET" || method === "HEAD",
      destructiveHint: method === "DELETE",
      idempotentHint: method === "GET" || method === "HEAD" || method === "PUT" || method === "DELETE",
      openWorldHint: true,
    },
    method,
    path,
    parameters: params,
    security: Array.isArray(operation.security) ? operation.security : globalSecurity,
  };
}

function mergeParameters(pathLevel: any[], operationLevel: any[]): any[] {
  const merged = [...pathLevel];
  for (const param of operationLevel ?? []) {
    const idx = merged.findIndex((p) => p && p.name === param.name && p.in === param.in);
    if (idx >= 0) merged[idx] = param;
    else merged.push(param);
  }
  return merged;
}

/** Convert OpenAPI/Swagger schema quirks into plain JSON Schema. */
export function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return {};
  const out: any = { ...schema };
  if (out.type === "file") out.type = "string"; // Swagger 2.0 file upload
  if (out.nullable === true && typeof out.type === "string") out.type = [out.type, "null"];
  if (out.properties && typeof out.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]: [string, any]) => [key, toJsonSchema(value)]),
    );
  }
  if (out.items) out.items = toJsonSchema(out.items);
  if (Array.isArray(out.required)) out.required = [...out.required];
  return out;
}

/** MCP-safe tool name. */
export function sanitizeName(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned || "tool";
}

/** Prefix every tool name, e.g. `petstore_getPets`. */
export function applyToolPrefix(tools: McpTool[], prefix: string): void {
  const clean = prefix
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);
  if (!clean) return;
  const used = new Set<string>();
  for (const tool of tools) {
    let name = sanitizeName(`${clean}_${tool.name}`);
    let counter = 2;
    while (used.has(name)) name = sanitizeName(`${clean}_${tool.name}_${counter++}`);
    used.add(name);
    tool.name = name;
  }
}

/** Public projection of a tool (what `tools/list` returns). */
export function publicTool(tool: McpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}
