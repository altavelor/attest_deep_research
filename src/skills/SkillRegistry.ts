export const SKILL_ROOT = ".ixplorer/skills";
const DEFAULTS_STATE_PATH = `${SKILL_ROOT}/.defaults.json`;
const MAX_FRONTMATTER_CHARS = 16_000;
const MAX_DESCRIPTION_CHARS = 1_000;
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9][a-zA-Z0-9_-]*)(?=\s|$)/g;

export interface SkillFileStore {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface DefaultSkillFile {
  id: string;
  content: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  aliases: string[];
  version?: string;
}

export interface SkillCatalogWarning {
  path: string;
  reason:
    | "invalid-skill-id"
    | "missing-frontmatter"
    | "frontmatter-too-large"
    | "missing-name"
    | "missing-description"
    | "description-too-large"
    | "invalid-aliases"
    | "duplicate-name"
    | "ambiguous-identifier"
    | "read-failed";
}

export interface SkillCatalogSnapshot {
  skills: SkillDefinition[];
  warnings: SkillCatalogWarning[];
}

export interface LoadedSkill {
  skill: SkillDefinition;
  content: string;
  characters: number;
  estimatedTokens: number;
  truncated: false;
}

export class SkillLoadError extends Error {
  readonly code: "invalid-skill" | "skill-too-large" | "skill-read-failed";

  constructor(code: SkillLoadError["code"], message: string) {
    super(message);
    this.name = "SkillLoadError";
    this.code = code;
  }
}

export type ExplicitSkillResolution =
  | { kind: "none"; normalizedQuestion: string }
  | { kind: "selected"; normalizedQuestion: string; skill: SkillDefinition }
  | {
      kind: "error";
      normalizedQuestion: string;
      reason: "multiple-skills" | "ambiguous-skill";
      mentions: string[];
    };

export interface SkillRegistryOptions {
  store: SkillFileStore;
  defaults: DefaultSkillFile[];
}

export class SkillRegistry {
  private readonly store: SkillFileStore;
  private readonly defaults: DefaultSkillFile[];
  private snapshot: SkillCatalogSnapshot = { skills: [], warnings: [] };
  private dirty = true;

  constructor(options: SkillRegistryOptions) {
    this.store = options.store;
    this.defaults = options.defaults;
  }

  async initialize(): Promise<SkillCatalogSnapshot> {
    await this.installDefaults();
    return this.refresh();
  }

  markDirty(): void {
    this.dirty = true;
  }

  async getSnapshot(options?: { refresh?: boolean }): Promise<SkillCatalogSnapshot> {
    if (this.dirty || options?.refresh === true) {
      return this.refresh();
    }

    return this.snapshot;
  }

  async refresh(): Promise<SkillCatalogSnapshot> {
    const warnings: SkillCatalogWarning[] = [];
    const parsed: SkillDefinition[] = [];

    if (!(await this.store.exists(SKILL_ROOT))) {
      this.snapshot = { skills: [], warnings: [] };
      this.dirty = false;
      return this.snapshot;
    }

    const listing = await this.store.list(SKILL_ROOT);
    const folders = listing.folders
      .map((path) => directChildName(SKILL_ROOT, path))
      .filter((id): id is string => id !== null)
      .sort();

    for (const id of folders) {
      const path = skillPath(id);
      if (!(await this.store.exists(path))) {
        continue;
      }
      if (!SKILL_ID_PATTERN.test(id)) {
        warnings.push({ path, reason: "invalid-skill-id" });
        continue;
      }

      try {
        const content = await this.store.read(path);
        const result = parseSkillFile(id, path, content);
        if ("warning" in result) {
          warnings.push(result.warning);
        } else {
          parsed.push(result.skill);
        }
      } catch {
        warnings.push({ path, reason: "read-failed" });
      }
    }

    const collisions = findCollisions(parsed);
    for (const skill of parsed) {
      const reasons = collisions.get(skill.id);
      if (!reasons) {
        continue;
      }
      for (const reason of reasons) {
        warnings.push({ path: skill.path, reason });
      }
    }

    this.snapshot = {
      skills: parsed.filter((skill) => !collisions.has(skill.id)).sort(compareSkills),
      warnings: warnings.sort((left, right) =>
        left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason),
      ),
    };
    this.dirty = false;
    return this.snapshot;
  }

  async load(skill: SkillDefinition, options?: { maxTokens?: number }): Promise<LoadedSkill> {
    const snapshot = await this.getSnapshot();
    const discovered = snapshot.skills.find(
      (candidate) => candidate.id === skill.id && candidate.path === skill.path,
    );
    if (!discovered || discovered.path !== skillPath(discovered.id)) {
      throw new SkillLoadError("invalid-skill", `Skill is not in ${SKILL_ROOT}: ${skill.path}`);
    }

    let content: string;
    try {
      content = await this.store.read(discovered.path);
    } catch (error) {
      throw new SkillLoadError(
        "skill-read-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    const estimatedTokens = estimateTokens(content);
    if (options?.maxTokens !== undefined && estimatedTokens > options.maxTokens) {
      throw new SkillLoadError(
        "skill-too-large",
        `Skill ${skill.id} requires ${estimatedTokens} tokens; ${options.maxTokens} available.`,
      );
    }

    return {
      skill: discovered,
      content,
      characters: content.length,
      estimatedTokens,
      truncated: false,
    };
  }

  private async installDefaults(): Promise<void> {
    await ensureFolder(this.store, ".ixplorer");
    await ensureFolder(this.store, SKILL_ROOT);
    const introduced = await readIntroducedDefaults(this.store);

    for (const file of this.defaults) {
      if (introduced.has(file.id)) {
        continue;
      }
      const folder = `${SKILL_ROOT}/${file.id}`;
      const path = skillPath(file.id);
      await ensureFolder(this.store, folder);
      if (!(await this.store.exists(path))) {
        await this.store.write(path, ensureTrailingNewline(file.content));
      }
      introduced.add(file.id);
    }

    await this.store.write(
      DEFAULTS_STATE_PATH,
      `${JSON.stringify({ introduced: [...introduced].sort() }, null, 2)}\n`,
    );
  }
}

export function buildSkillCatalogPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) {
    return "Available skills: None.";
  }

  return [
    "Available skills (load at most one only when it clearly applies):",
    ...skills.map(
      (skill) => `- ${skill.name}: ${skill.description}\n  Path: ${skill.path}`,
    ),
  ].join("\n");
}

export function resolveExplicitSkill(
  question: string,
  skills: SkillDefinition[],
): ExplicitSkillResolution {
  const matches = [...question.matchAll(MENTION_PATTERN)];
  const identifiers = new Map<string, SkillDefinition[]>();
  for (const skill of skills) {
    for (const identifier of [skill.id, ...skill.aliases]) {
      const key = identifier.toLowerCase();
      identifiers.set(key, [...(identifiers.get(key) ?? []), skill]);
    }
  }

  const recognized: Array<{ raw: string; skill: SkillDefinition }> = [];
  for (const match of matches) {
    const candidates = identifiers.get(match[2].toLowerCase()) ?? [];
    if (candidates.length > 1) {
      return {
        kind: "error",
        normalizedQuestion: question.trim(),
        reason: "ambiguous-skill",
        mentions: [match[2]],
      };
    }
    if (candidates.length === 1) {
      recognized.push({ raw: match[0], skill: candidates[0] });
    }
  }

  const distinctSkills = new Map(recognized.map((item) => [item.skill.id, item.skill]));
  if (distinctSkills.size > 1) {
    return {
      kind: "error",
      normalizedQuestion: removeMentions(question, recognized.map((item) => item.raw)),
      reason: "multiple-skills",
      mentions: [...distinctSkills.keys()],
    };
  }
  if (distinctSkills.size === 0) {
    return { kind: "none", normalizedQuestion: question.trim() };
  }

  return {
    kind: "selected",
    normalizedQuestion: removeMentions(question, recognized.map((item) => item.raw)),
    skill: [...distinctSkills.values()][0],
  };
}

function parseSkillFile(
  id: string,
  path: string,
  content: string,
): { skill: SkillDefinition } | { warning: SkillCatalogWarning } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { warning: { path, reason: "missing-frontmatter" } };
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const closing = normalized.indexOf("\n---", 4);
  if (closing === -1) {
    return { warning: { path, reason: "missing-frontmatter" } };
  }
  const frontmatter = normalized.slice(4, closing);
  if (frontmatter.length > MAX_FRONTMATTER_CHARS) {
    return { warning: { path, reason: "frontmatter-too-large" } };
  }

  const fields = parseFrontmatter(frontmatter);
  const name = scalar(fields.get("name"));
  const description = scalar(fields.get("description"));
  if (!name) {
    return { warning: { path, reason: "missing-name" } };
  }
  if (!description) {
    return { warning: { path, reason: "missing-description" } };
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return { warning: { path, reason: "description-too-large" } };
  }
  const aliases = list(fields.get("aliases"));
  if (aliases === null) {
    return { warning: { path, reason: "invalid-aliases" } };
  }

  return {
    skill: {
      id,
      name,
      description,
      path,
      aliases,
      ...(scalar(fields.get("version")) ? { version: scalar(fields.get("version")) } : {}),
    },
  };
}

type FrontmatterValue = string | string[];

function parseFrontmatter(frontmatter: string): Map<string, FrontmatterValue> {
  const fields = new Map<string, FrontmatterValue>();
  let listKey: string | null = null;

  for (const rawLine of frontmatter.split("\n")) {
    const listMatch = rawLine.match(/^\s+-\s+(.+)$/);
    if (listMatch && listKey) {
      const existing = fields.get(listKey);
      fields.set(listKey, [...(Array.isArray(existing) ? existing : []), unquote(listMatch[1])]);
      continue;
    }
    const fieldMatch = rawLine.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!fieldMatch) {
      listKey = null;
      continue;
    }
    const key = fieldMatch[1].toLowerCase();
    const value = (fieldMatch[2] ?? "").trim();
    if (!value) {
      fields.set(key, []);
      listKey = key;
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      fields.set(
        key,
        value
          .slice(1, -1)
          .split(",")
          .map((item) => unquote(item.trim()))
          .filter(Boolean),
      );
      listKey = null;
      continue;
    }
    fields.set(key, unquote(value));
    listKey = null;
  }

  return fields;
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: FrontmatterValue | undefined): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  return normalized.every((item) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(item))
    ? [...new Set(normalized)]
    : null;
}

function findCollisions(
  skills: SkillDefinition[],
): Map<SkillDefinition["id"], Set<"duplicate-name" | "ambiguous-identifier">> {
  const collisions = new Map<
    SkillDefinition["id"],
    Set<"duplicate-name" | "ambiguous-identifier">
  >();
  const names = groupBy(skills, (skill) => skill.name.toLowerCase());
  for (const group of names.values()) {
    if (group.length > 1) {
      for (const skill of group) {
        addCollision(collisions, skill.id, "duplicate-name");
      }
    }
  }

  const identifiers = new Map<string, Set<string>>();
  for (const skill of skills) {
    for (const identifier of [skill.id, ...skill.aliases]) {
      const ids = identifiers.get(identifier.toLowerCase()) ?? new Set<string>();
      ids.add(skill.id);
      identifiers.set(identifier.toLowerCase(), ids);
    }
  }
  for (const ids of identifiers.values()) {
    if (ids.size > 1) {
      for (const id of ids) {
        addCollision(collisions, id, "ambiguous-identifier");
      }
    }
  }

  return collisions;
}

function addCollision(
  collisions: Map<string, Set<"duplicate-name" | "ambiguous-identifier">>,
  id: string,
  reason: "duplicate-name" | "ambiguous-identifier",
): void {
  const reasons = collisions.get(id) ?? new Set();
  reasons.add(reason);
  collisions.set(id, reasons);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function skillPath(id: string): string {
  return `${SKILL_ROOT}/${id}/SKILL.md`;
}

function directChildName(parent: string, path: string): string | null {
  const prefix = `${parent}/`;
  if (!path.startsWith(prefix)) {
    return null;
  }
  const rest = path.slice(prefix.length).replace(/\/$/, "");
  return rest && !rest.includes("/") ? rest : null;
}

function compareSkills(left: SkillDefinition, right: SkillDefinition): number {
  return left.id.localeCompare(right.id);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function removeMentions(question: string, mentions: string[]): string {
  let normalized = question;
  for (const mention of mentions) {
    normalized = normalized.replace(mention, " ");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

async function ensureFolder(store: SkillFileStore, path: string): Promise<void> {
  if (!(await store.exists(path))) {
    await store.mkdir(path);
  }
}

async function readIntroducedDefaults(store: SkillFileStore): Promise<Set<string>> {
  if (!(await store.exists(DEFAULTS_STATE_PATH))) {
    return new Set();
  }
  try {
    const value = JSON.parse(await store.read(DEFAULTS_STATE_PATH)) as { introduced?: unknown };
    return new Set(
      Array.isArray(value.introduced)
        ? value.introduced.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
