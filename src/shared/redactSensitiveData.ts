const SENSITIVE_KEY =
  /(^|[_-])(api[_-]?key|access[_-]?token|private[_-]?key|token|secret|password|authorization)($|[_-])/i;
const CREDENTIAL_NAME =
  "(?:[a-z0-9]+[_-]?)?(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|token|secret|password|authorization)";
const AUTH_SCHEME = "(?:(?:Bearer|Basic|Token|Digest)\\s+)?";
const SENSITIVE_ASSIGNMENT = new RegExp(
  `\\b(${CREDENTIAL_NAME})\\s*[:=]\\s*${AUTH_SCHEME}([^\\s,;&]+)`,
  "gi",
);
const SENSITIVE_JSON_FIELD = new RegExp(
  `("${CREDENTIAL_NAME}"\\s*:\\s*"${AUTH_SCHEME})(?:\\\\.|[^"\\\\])*"`,
  "gi",
);
const SENSITIVE_JSON_SCALAR = new RegExp(
  `("${CREDENTIAL_NAME}"\\s*:\\s*)(?!["{[])[^,}\\]\\s]+`,
  "gi",
);

/** Remove credential values from values that may be written to logs or diagnostics. */
export function redactSensitiveData<T>(value: T): T {
  return redactValue(value) as T;
}

/** Redacts credentials in `text`; a value stored under a credential-like `key` is replaced whole. */
export function redactSensitiveText(text: string, key?: string): string {
  return key !== undefined && isSensitiveKey(key) ? "[redacted]" : redactSensitiveString(text);
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
    redacted[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(item);
  }
  return redacted;
}

/** True for a credential-like key, also when its words are joined in camelCase. */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
}

function redactSensitiveString(value: string): string {
  const redactedUrl = value.replace(/https?:\/\/[^\s,;"<>`\\]+/gi, redactUrlQuerySecrets);
  return redactedUrl
    .replace(/\bBearer\s+[^\s,;"'<>`\\]+/gi, "Bearer [redacted]")
    .replace(SENSITIVE_JSON_FIELD, '$1[redacted]"')
    .replace(SENSITIVE_JSON_SCALAR, '$1"[redacted]"')
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
    if (isSensitiveKey(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}
