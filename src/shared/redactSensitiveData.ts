const SENSITIVE_KEY = /^(api[_-]?key|access[_-]?token|token|secret|password|authorization)$/i;

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
  const redactedUrl = redactUrlQuerySecrets(value);
  return redactedUrl
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(authorization|api[_ -]?key|access[_ -]?token|token|secret|password)\s*[:=]\s*(?:Bearer\s+)?([^\s,;]+)/gi,
      "$1=[redacted]",
    );
}

function redactUrlQuerySecrets(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  for (const [key] of url.searchParams) {
    if (SENSITIVE_KEY.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}
