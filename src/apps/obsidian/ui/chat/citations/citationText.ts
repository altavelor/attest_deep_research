import { CITATION_TOKEN_SOURCE } from "@core/research";

export { CITATION_TOKEN_SOURCE };

export function stripRenderedCitationIds(value: string): string {
  return value.replace(new RegExp(`\\s*${CITATION_TOKEN_SOURCE}`, "g"), "");
}
