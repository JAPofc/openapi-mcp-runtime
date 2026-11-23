// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import type { AuthOptions, OAuth2Credential } from "./types.js";

export interface ResolvedAuth {
  headers: Record<string, string>;
  query: URLSearchParams;
  /** True when every requirement in the chosen alternative could be satisfied. */
  satisfied: boolean;
  /** Names of the security schemes that were applied. */
  applied: string[];
}

interface TokenEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenEntry>();

/** Clear the OAuth2 token cache (useful for tests / long-running reloads). */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Resolve the first satisfiable security requirement and produce the headers /
 * query params needed to call the API. Never throws for missing credentials —
 * the caller proceeds unauthenticated and the API decides.
 */
export async function resolveAuth(
  requirements: any[],
  schemes: Record<string, any>,
  auth: AuthOptions,
): Promise<ResolvedAuth> {
  const headers: Record<string, string> = { ...(auth.headers ?? {}) };
  const query = new URLSearchParams();
  const applied: string[] = [];

  if (auth.basic) {
    headers["authorization"] = `Basic ${btoa(`${auth.basic.username}:${auth.basic.password}`)}`;
  } else if (auth.bearer) {
    headers["authorization"] = `Bearer ${auth.bearer}`;
  }

  if (!requirements || requirements.length === 0) {
    return { headers, query, satisfied: true, applied };
  }

  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== "object") continue;
    const outcome = await satisfyRequirement(requirement, schemes, auth);
    if (outcome) {
      for (const [key, value] of Object.entries(outcome.headers)) headers[key] = value;
      for (const [key, value] of outcome.query) query.append(key, value);
      applied.push(...outcome.applied);
      return { headers, query, satisfied: true, applied };
    }
  }

  // No requirement fully satisfiable: send whatever static auth we have.
  return { headers, query, satisfied: false, applied };
}

async function satisfyRequirement(
  requirement: Record<string, any>,
  schemes: Record<string, any>,
  auth: AuthOptions,
): Promise<{ headers: Record<string, string>; query: string[][]; applied: string[] } | null> {
  const result: { headers: Record<string, string>; query: string[][]; applied: string[] } = {
    headers: {},
    query: [],
    applied: [],
  };

  for (const [schemeName, scopes] of Object.entries(requirement)) {
    const scheme = schemes[schemeName];
    if (!scheme) return null;

    switch (scheme.type) {
      case "apiKey": {
        const value = auth.apiKeys?.[schemeName];
        if (!value) return null;
        if (scheme.in === "query") result.query.push([scheme.name, value]);
        else if (scheme.in === "cookie") result.headers["cookie"] = `${scheme.name}=${value}`;
        else result.headers[scheme.name] = value;
        result.applied.push(schemeName);
        break;
      }
      case "http": {
        if (scheme.scheme === "bearer") {
          if (!auth.bearer) return null;
          result.applied.push(schemeName);
        } else if (scheme.scheme === "basic") {
          if (!auth.basic) return null;
          result.applied.push(schemeName);
        } else {
          return null;
        }
        break;
      }
      case "oauth2": {
        const cred: OAuth2Credential | undefined = auth.oauth2?.[schemeName];
        if (!cred) return null;
        const token = await getOAuth2Token(schemeName, scheme, cred);
        if (!token) return null;
        result.headers["authorization"] = `Bearer ${token}`;
        result.applied.push(schemeName);
        break;
      }
      default:
        return null;
    }
  }

  return result;
}

async function getOAuth2Token(schemeName: string, scheme: any, cred: OAuth2Credential): Promise<string | null> {
  const cacheKey = `${schemeName}:${cred.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5_000) return cached.token;

  const flow = scheme.flows?.clientCredentials ?? scheme.flows?.authorizationCode ?? Object.values(scheme.flows ?? {})[0];
  const tokenUrl: string | undefined = cred.tokenUrl ?? flow?.tokenUrl;
  if (!tokenUrl) return null;

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (cred.scopes?.length) body.set("scope", cred.scopes.join(" "));

  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cred.clientSecret) {
    headers["authorization"] = `Basic ${btoa(`${cred.clientId}:${cred.clientSecret}`)}`;
  } else {
    body.set("client_id", cred.clientId);
  }

  try {
    const res = await fetch(tokenUrl, { method: "POST", headers, body: body.toString() });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.access_token) return null;
    const ttl = typeof data.expires_in === "number" ? data.expires_in * 1000 : 3_600_000;
    tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + ttl });
    return data.access_token;
  } catch {
    return null;
  }
}
