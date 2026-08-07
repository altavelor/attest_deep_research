const CITATION_HANDLE_SOURCE = "[^\\]\\n\\s]{8,}";

/**
 * Shape of a rendered citation handle: a bracketed run of at least eight
 * non-space characters. Ordinary bracketed prose contains spaces and is left
 * alone, so `[Important note]` survives while a stale handle does not.
 */
export const CITATION_TOKEN_SOURCE = `\\[(${CITATION_HANDLE_SOURCE})\\]`;

const CITATION_HANDLE = new RegExp(`^${CITATION_HANDLE_SOURCE}$`);

export function isCitationHandle(token: string): boolean {
  return CITATION_HANDLE.test(token);
}
