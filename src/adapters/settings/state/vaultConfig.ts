export function withVaultConfigExclusion(
  excludeGlobs: readonly string[],
  configDir: string | undefined,
): string[] {
  if (!configDir) return [...excludeGlobs];
  const normalizedConfigDir = configDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedConfigDir) return [...excludeGlobs];

  const configGlob = `${normalizedConfigDir}/**`;
  return [configGlob, ...excludeGlobs.filter((glob) => glob !== configGlob)];
}
