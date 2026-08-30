import type { ServerProfile } from "@adapters/settings";
import { AttestError } from "@core/errors";
import { obsidianRequestFetch } from "./obsidianFetch";

export type ProviderRequestKind = "streaming" | "buffered";

export function resolveProviderFetch(
  server: ServerProfile,
  _requestKind: ProviderRequestKind,
  isMobile: boolean,
): typeof fetch {
  if (!isMobile) return fetch;
  if (isMobileLocalProvider(server)) return unavailableMobileLocalFetch;
  return obsidianRequestFetch;
}

export function isMobileLocalProvider(server: ServerProfile): boolean {
  if (server.apiFormat === "ollama") return true;
  try {
    const hostname = new URL(server.baseUrl).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      isIpv4Loopback(hostname)
    );
  } catch {
    return false;
  }
}

const unavailableMobileLocalFetch: typeof fetch = async () => {
  throw new AttestError({
    code: "UNSUPPORTED_CAPABILITY",
    message:
      "Local model providers are not available on Obsidian Mobile. Configure a cloud provider endpoint.",
  });
};

function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}
