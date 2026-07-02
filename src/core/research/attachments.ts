// Attachment manifest: tells the model which vault files the user attached to
// the message and how their content was delivered. Without it, attachments
// dissolve into anonymous evidence chunks and the model cannot list them or
// address them with vault tools for reading/editing.

/** How an attached file's content reached the prompt. */
export type AttachedFileCoverage =
  /** Whole file inlined under Explicit context. */
  | "full"
  /** Only relevance-ranked excerpts inlined (file too large for the budget). */
  | "excerpts"
  /** Nothing inlined; the model is expected to read it via vault tools. */
  | "reference"
  /** Content unavailable (unsupported type, read failure, or budget exhausted). */
  | "omitted";

export interface AttachedFileManifestEntry {
  path: string;
  coverage: AttachedFileCoverage;
}

export interface AttachmentManifestOptions {
  /** When true, the manifest tells the model it can read/edit these via vault tools. */
  noteToolsAvailable?: boolean;
}

const COVERAGE_NOTES: Record<AttachedFileCoverage, string> = {
  full: "full content included under Explicit context",
  excerpts: "excerpts only under Explicit context (ranked by relevance to the question)",
  reference: "content not inlined — read it with read_note using this exact path",
  omitted: "content unavailable (unsupported type or context budget exceeded)",
};

/**
 * Renders the "Attached files" prompt section. Returns "" when nothing is
 * attached so callers can push it unconditionally.
 */
export function buildAttachmentManifestSection(
  entries: readonly AttachedFileManifestEntry[],
  options: AttachmentManifestOptions = {},
): string {
  if (entries.length === 0) {
    return "";
  }

  const lines = [
    "Attached files (vault notes the user attached to this message):",
    ...entries.map((entry) => `- ${entry.path} — ${COVERAGE_NOTES[entry.coverage]}`),
  ];
  lines.push(
    options.noteToolsAvailable
      ? "These are real vault notes. To list them, quote them in full, or edit them, call the vault tools (read_note, update_note) with the exact paths above."
      : "These are real vault notes; the paths above are their locations in the user's vault.",
  );
  return lines.join("\n");
}
