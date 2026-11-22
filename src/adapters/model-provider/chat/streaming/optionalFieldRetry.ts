import { isRecord } from "@shared";
import { AttestError } from "@core/errors";

const REMEMBERED_REFUSAL_LIMIT = 64;
const GENERIC_UNKNOWN_FIELD =
  /unknown|unrecognized|unsupported|not (supported|allowed|permitted)|extra (fields|inputs)|additional propert/;

/**
 * Remembers which optional body fields a provider refused for a model, so later
 * rounds of the same client omit them instead of paying a failed request each.
 */
export class RejectedFieldMemory {
  private readonly refused = new Set<string>();

  accepted(model: string, fields: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(fields).filter(([key]) => !this.refused.has(`${model}\n${key}`)),
    );
  }

  remember(model: string, fields: Iterable<string>): void {
    for (const field of fields) {
      if (this.refused.size >= REMEMBERED_REFUSAL_LIMIT) return;
      this.refused.add(`${model}\n${field}`);
    }
  }
}

/**
 * Returns the optional fields to keep on a retry, or undefined when the refusal
 * does not concern them. A refusal that names some fields drops only those; a
 * generic unknown-field refusal drops them all; any other failure is not retried.
 */
export function fieldsAfterRefusal(
  fields: Record<string, unknown>,
  error: unknown,
): Record<string, unknown> | undefined {
  if (Object.keys(fields).length === 0 || !rejectsBody(error)) return undefined;
  const message = refusalText(error).toLowerCase();
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !message.includes(key.toLowerCase())),
  );
  if (Object.keys(kept).length < Object.keys(fields).length) return kept;
  return GENERIC_UNKNOWN_FIELD.test(message) ? {} : undefined;
}

function rejectsBody(error: unknown): boolean {
  const status: unknown =
    error instanceof AttestError && isRecord(error.details) ? error.details.status : undefined;
  return status === 400 || status === 422;
}

function refusalText(error: unknown): string {
  if (!(error instanceof AttestError)) {
    return "";
  }
  const nested: unknown = isRecord(error.details) ? error.details.providerMessage : undefined;
  return [error.message, nested].filter((part) => typeof part === "string").join(" ");
}
