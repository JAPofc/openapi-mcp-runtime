// SPDX-License-Identifier: MIT
// Copyright (c) 2026 japofc
// https://github.com/japofc/openapi-mcp-runtime

import type { ExecuteResult } from "./types.js";

interface Entry {
  expiresAt: number;
  result: ExecuteResult;
}

const store = new Map<string, Entry>();

export function cacheGet(key: string): ExecuteResult | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.result;
}

export function cacheSet(key: string, ttlSeconds: number, result: ExecuteResult): void {
  store.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, result });
}

export function cacheClear(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}
