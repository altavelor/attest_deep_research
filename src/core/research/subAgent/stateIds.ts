const SAFE_ID = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/u;

/** True when the value can be stored as an id of the sub-agent section. */
export function isSubAgentStateId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}
