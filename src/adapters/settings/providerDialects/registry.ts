import {
  cerebrasDialect,
  deepSeekDialect,
  fireworksDialect,
  genericOpenAiDialect,
  groqDialect,
  nebiusDialect,
  novitaDialect,
  openAiDialect,
} from "./flatDialects";
import { deepInfraDialect, mistralDialect, togetherDialect } from "./metadataDialects";
import { openRouterDialect } from "./openRouter";
import { ProviderDialect } from "./types";

export const providerDialects: readonly ProviderDialect[] = [
  openRouterDialect,
  deepInfraDialect,
  togetherDialect,
  mistralDialect,
  openAiDialect,
  groqDialect,
  fireworksDialect,
  deepSeekDialect,
  cerebrasDialect,
  nebiusDialect,
  novitaDialect,
];

/**
 * Picks the dialect whose host matches the configured base URL, falling back to
 * the plain OpenAI-compatible dialect for self-hosted and unknown endpoints.
 */
export function resolveProviderDialect(baseUrl: string): ProviderDialect {
  const host = hostOf(baseUrl);
  if (!host) {
    return genericOpenAiDialect;
  }

  return (
    providerDialects.find((dialect) =>
      dialect.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
    ) ?? genericOpenAiDialect
  );
}

function hostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl.trim()).hostname.toLocaleLowerCase();
  } catch {
    return undefined;
  }
}
