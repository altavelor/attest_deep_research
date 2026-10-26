import type { ChainItem } from "@core/conversation";

/** Identifies a tool call across renders by its timeline scope, run and call id. */
export function toolKey(scopeId: string, item: Extract<ChainItem, { kind: "tool-call" }>): string {
  return item.attempt ? `${scopeId}/${item.attempt.runId}/${item.id}` : `${scopeId}/${item.id}`;
}
