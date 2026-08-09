#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_DIR = "dist";
const REQUIRED_ASSETS = ["main.js", "manifest.json", "styles.css"];
const REQUIRED_REPOSITORY_FILES = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "manifest.json",
  "versions.json",
];
const FORBIDDEN_RELEASE_ENTRIES = ["node_modules", ".git", ".env"];
const FORBIDDEN_RELEASE_EXTENSIONS = [".log", ".map", ".env"];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const SECRET_PATTERNS = [
  { name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "OpenAI API key", pattern: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Slack token", pattern: /xox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: "PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/**
 * Verifies that the manifest, package and versions metadata describe one
 * consistent release. Returns a problem message per inconsistency.
 */
export function checkVersionMetadata({ manifest, packageJson, versions }) {
  const problems = [];
  if (!isJsonObject(manifest)) problems.push("manifest.json must contain a JSON object");
  if (!isJsonObject(packageJson)) problems.push("package.json must contain a JSON object");
  if (!isJsonObject(versions)) problems.push("versions.json must contain a JSON object");
  if (problems.length > 0) return problems;

  const version = manifest.version;

  if (typeof version !== "string" || !SEMVER.test(version)) {
    problems.push(`manifest.json version "${version}" is not a valid semantic version`);
    return problems;
  }
  if (typeof manifest.minAppVersion !== "string" || !SEMVER.test(manifest.minAppVersion)) {
    problems.push(`manifest.json minAppVersion "${manifest.minAppVersion}" is not a valid version`);
  }
  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    problems.push(`manifest.json id "${manifest.id}" must be lowercase letters, digits and dashes`);
  }
  if (typeof manifest.id === "string" && manifest.id.includes("obsidian")) {
    problems.push('manifest.json id must not contain "obsidian"');
  }
  if (packageJson.version !== version) {
    problems.push(`package.json version ${packageJson.version} does not match manifest ${version}`);
  }

  const minAppVersion = versions[version];
  if (!minAppVersion) {
    problems.push(`versions.json does not contain an entry for ${version}`);
  } else if (minAppVersion !== manifest.minAppVersion) {
    problems.push(
      `versions.json maps ${version} to ${minAppVersion}, ` +
        `but manifest.json declares ${manifest.minAppVersion}`,
    );
  }

  return problems;
}

function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the built release directory listing for the assets Obsidian requires
 * and for entries that must never be published.
 */
export function checkReleaseEntries(entries) {
  const problems = [];
  const names = new Set(entries);

  for (const asset of REQUIRED_ASSETS) {
    if (!names.has(asset)) problems.push(`${RELEASE_DIR}/${asset} is missing`);
  }
  for (const entry of entries) {
    if (FORBIDDEN_RELEASE_ENTRIES.includes(entry)) {
      problems.push(`${RELEASE_DIR}/${entry} must not be published`);
      continue;
    }
    const extension = FORBIDDEN_RELEASE_EXTENSIONS.find((suffix) => entry.endsWith(suffix));
    if (extension) problems.push(`${RELEASE_DIR}/${entry} must not be published`);
  }

  return problems;
}

/**
 * Returns the names of the secret patterns that match the given text.
 */
export function findSecrets(text) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/**
 * Parses JSON and reports the file path together with the parser message so a
 * malformed release file is actionable.
 */
export function parseJsonFile(path, read = (target) => readFileSync(target, "utf8")) {
  try {
    return { value: JSON.parse(read(path)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { problem: `${path} is not valid JSON: ${reason}` };
  }
}

function listFilesRecursively(directory, root = directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...listFilesRecursively(absolute, root));
      continue;
    }
    files.push(relative(root, absolute));
  }
  return files;
}

export function checkReleaseDirectory(rootDir) {
  const releaseDir = resolve(rootDir, RELEASE_DIR);
  let entries;
  try {
    entries = readdirSync(releaseDir);
  } catch {
    return [`${RELEASE_DIR}/ is missing; run "npm run build" before the release check`];
  }

  const problems = checkReleaseEntries(entries);
  const manifestPath = join(releaseDir, "manifest.json");
  if (entries.includes("manifest.json")) {
    const parsed = parseJsonFile(manifestPath);
    if (parsed.problem) problems.push(parsed.problem);
  }

  for (const file of listFilesRecursively(releaseDir)) {
    const absolute = join(releaseDir, file);
    for (const secret of findSecrets(readFileSync(absolute, "utf8"))) {
      problems.push(`${RELEASE_DIR}/${file} contains what looks like a ${secret}`);
    }
  }

  return problems;
}

function checkRepositoryFiles(rootDir) {
  const problems = [];
  for (const file of REQUIRED_REPOSITORY_FILES) {
    try {
      statSync(resolve(rootDir, file));
    } catch {
      problems.push(`${file} is missing from the repository root`);
    }
  }
  return problems;
}

function main() {
  const rootDir = process.cwd();
  const problems = [];

  const manifest = parseJsonFile(resolve(rootDir, "manifest.json"));
  const packageJson = parseJsonFile(resolve(rootDir, "package.json"));
  const versions = parseJsonFile(resolve(rootDir, "versions.json"));

  for (const parsed of [manifest, packageJson, versions]) {
    if (parsed.problem) problems.push(parsed.problem);
  }

  if (!manifest.problem && !packageJson.problem && !versions.problem) {
    problems.push(
      ...checkVersionMetadata({
        manifest: manifest.value,
        packageJson: packageJson.value,
        versions: versions.value,
      }),
    );
  }

  problems.push(...checkRepositoryFiles(rootDir));
  problems.push(...checkReleaseDirectory(rootDir));

  if (problems.length > 0) {
    console.error("Release check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Release check passed for version ${manifest.value.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
