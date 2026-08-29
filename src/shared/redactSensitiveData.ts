const SENSITIVE_KEY =
  /(^|[_-])(api[_-]?key|access[_-]?token|token|secret|password|authorization)($|[_-])/i;
const SENSITIVE_ASSIGNMENT =
  /\b((?:[a-z0-9]+[_-])?(?:api[_ -]?key|access[_ -]?token|token|secret|password|authorization))\s*[:=]\s*(?:Bearer\s+)?([^\s,;&]+)/gi;

/** Remove credential values from values that may be written to logs or diagnostics. */
export function redactSensitiveData<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactValue(item);
  }
  return redacted;
}

function redactSensitiveString(value: string): string {
  const redactedUrl = value.replace(/https?:\/\/[^\s,;"<>`\\]+/gi, redactUrlQuerySecrets);
  return redactedUrl
    .replace(/\bBearer\s+[^\s,;"'<>`\\]+/gi, "Bearer [redacted]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[redacted]");
}

function redactUrlQuerySecrets(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  url.username = "";
  url.password = "";

  for (const [key] of Array.from(url.searchParams)) {
    if (SENSITIVE_KEY.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}
