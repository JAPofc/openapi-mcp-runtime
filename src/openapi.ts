// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import RefParser from "@apidevtools/json-schema-ref-parser";

export type SpecDocument = Record<string, any>;

/**
 * Load an OpenAPI / Swagger document from a file path or URL and dereference
 * all `$ref` pointers (internal, external files and remote URLs).
 */
export async function loadSpec(source: string): Promise<SpecDocument> {
  if (!source || !source.trim()) {
    throw new Error("OpenAPI spec source is required (file path or URL).");
  }
  let spec: any;
  try {
    spec = await RefParser.dereference(source, {
      dereference: { circular: "ignore" },
    } as any);
  } catch (err: any) {
    throw new Error(`Failed to load OpenAPI spec from "${source}": ${err?.message ?? String(err)}`);
  }
  if (!spec || typeof spec !== "object") {
    throw new Error(`OpenAPI spec at "${source}" is empty or not an object.`);
  }
  if (!spec.openapi && !spec.swagger) {
    throw new Error(
      `Not an OpenAPI/Swagger document: "${source}" has no "openapi" or "swagger" field.`,
    );
  }
  return spec as SpecDocument;
}

export function specKind(spec: SpecDocument): "openapi3" | "swagger2" | "unknown" {
  if (spec.openapi) return "openapi3";
  if (spec.swagger) return "swagger2";
  return "unknown";
}

/** Human readable spec label, e.g. "OpenAPI 3.1.0" or "Swagger 2.0". */
export function specLabel(spec: SpecDocument): string {
  return spec.openapi ? `OpenAPI ${spec.openapi}` : spec.swagger ? `Swagger ${spec.swagger}` : "Unknown";
}

/** Resolve the base server URL, honouring an explicit override. */
export function resolveServerUrl(spec: SpecDocument, override?: string): string {
  if (override) return stripTrailingSlash(override);
  if (spec.openapi) {
    const server: any = Array.isArray(spec.servers) ? spec.servers[0] : undefined;
    let url: string = server?.url ?? "http://localhost";
    const variables = server?.variables ?? {};
    url = url.replace(/\{([^}]+)\}/g, (_m, key: string) => variables[key]?.default ?? `{${key}}`);
    return stripTrailingSlash(url);
  }
  // Swagger 2.0
  const schemes: string[] = Array.isArray(spec.schemes) ? spec.schemes : [];
  const scheme = schemes[0] ?? "https";
  const host: string = spec.host ?? "localhost";
  const basePath: string = spec.basePath ?? "";
  return stripTrailingSlash(`${scheme}://${host}${basePath}`);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
