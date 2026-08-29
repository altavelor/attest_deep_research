export type PromptPriority = "policy" | "workflow" | "reference" | "untrusted-data";

export interface PromptSection {
  id: string;
  priority: PromptPriority;
  enabled: boolean;
  content: string;
  referencedTools: readonly string[];
}

export type PromptAssemblyIssueCode =
  "duplicate-id" | "unregistered-tool" | "unbalanced-delimiter" | "empty-content";

export interface PromptAssemblyIssue {
  sectionId: string;
  code: PromptAssemblyIssueCode;
  detail: string;
  dropped: boolean;
}

export interface PromptAssemblyResult {
  text: string;
  sections: readonly PromptSection[];
  issues: readonly PromptAssemblyIssue[];
}

export interface PromptAssemblyOptions {
  availableTools: ReadonlySet<string>;
}

const PRIORITY_ORDER: Record<PromptPriority, number> = {
  policy: 0,
  workflow: 1,
  reference: 2,
  "untrusted-data": 3,
};

const DELIMITED_TAGS = [
  "index-description",
  "explicit-evidence",
  "attached-files",
  "conversation-registry",
] as const;

/**
 * Orders enabled sections by priority and validates them. Only `reference` sections
 * may be dropped on a defect; a defective `policy` or `workflow` section is reported
 * and kept, because removing guidance is worse than the defect it reports.
 */
export function assemblePromptSections(
  sections: readonly PromptSection[],
  options: PromptAssemblyOptions,
): PromptAssemblyResult {
  const issues: PromptAssemblyIssue[] = [];
  const seen = new Set<string>();
  const kept: PromptSection[] = [];

  for (const section of sections) {
    if (!section.enabled) continue;

    const dropped = section.priority === "reference";
    const defects: Array<{ code: PromptAssemblyIssueCode; detail: string }> = [];
    if (seen.has(section.id)) defects.push({ code: "duplicate-id", detail: section.id });
    if (section.content.trim().length === 0) {
      defects.push({ code: "empty-content", detail: section.id });
    }
    for (const tool of section.referencedTools) {
      if (!options.availableTools.has(tool)) {
        defects.push({ code: "unregistered-tool", detail: tool });
      }
    }
    for (const tag of DELIMITED_TAGS) {
      if (!balancedDelimiters(section.content, tag)) {
        defects.push({ code: "unbalanced-delimiter", detail: tag });
      }
    }
    for (const defect of defects) {
      issues.push({ sectionId: section.id, ...defect, dropped });
    }

    const unusable = defects.some(
      (defect) => defect.code === "duplicate-id" || defect.code === "empty-content",
    );
    seen.add(section.id);
    if (unusable || (defects.length > 0 && dropped)) continue;
    kept.push(section);
  }

  const ordered = [...kept].sort(
    (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
  );

  return {
    text: ordered.map((section) => section.content.trim()).join("\n\n"),
    sections: ordered,
    issues,
  };
}

function balancedDelimiters(content: string, tag: string): boolean {
  const open = countOccurrences(content, `<${tag}`);
  const close = countOccurrences(content, `</${tag}>`);
  return open === close;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Escapes the characters that let untrusted text close a delimiter or forge markup. */
export function sanitizeUntrusted(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function section(
  id: string,
  priority: PromptPriority,
  content: string,
  referencedTools: readonly string[] = [],
): PromptSection {
  return { id, priority, enabled: true, content, referencedTools };
}

export function optionalSection(
  id: string,
  priority: PromptPriority,
  enabled: boolean,
  content: () => string,
  referencedTools: readonly string[] = [],
): PromptSection {
  return {
    id,
    priority,
    enabled,
    content: enabled ? content() : "",
    referencedTools: enabled ? referencedTools : [],
  };
}
