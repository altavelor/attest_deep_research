import type { ResearchNoteWriter } from "@application/ports/researchExport";
import {
  resolveConversationEvidence,
  type ConversationSourceRegistry,
} from "@core/chat/sourceRegistry";
import type { SourceReference } from "@core/model";
import { CITATION_TOKEN_SOURCE } from "@core/research";
import {
  MAX_EXPORT_NAME_ATTEMPTS,
  checkExportFolder,
  deepResearchRejected,
  exportFileName,
  serializeResearchExport,
  type ResearchReport,
} from "@core/research/deepResearch";

export interface ResearchExportContext {
  chatId: string;
  researchId: string;
  title: string;
  registry: ConversationSourceRegistry;
}

export interface ResearchExportDeps {
  writer: ResearchNoteWriter;
  defaultFolder(): string;
  now(): Date;
  context: ResearchExportContext;
}

/**
 * Exports one finished research report of a chat as a new Markdown note. The folder, default or
 * override, is checked as untrusted input, and a taken name moves to the next numbered suffix; an
 * existing note is never replaced and the report itself is never changed.
 */
export class ResearchExportService {
  constructor(private readonly deps: ResearchExportDeps) {}

  async export(report: ResearchReport, folder?: string): Promise<{ path: string }> {
    const checked = checkExportFolder(folder ?? this.deps.defaultFolder());
    if (!checked.ok) throw deepResearchRejected("research-export-folder", checked.reason);
    const { context, writer } = this.deps;
    const content = serializeResearchExport({
      report,
      chatId: context.chatId,
      researchId: context.researchId,
      sources: registrySources(context.registry, report.markdown),
    });
    await writer.ensureFolder(checked.folder);
    const date = this.deps.now();
    for (let attempt = 1; attempt <= MAX_EXPORT_NAME_ATTEMPTS; attempt += 1) {
      const path = `${checked.folder}/${exportFileName(context.title, date, attempt)}`;
      if (await writer.exists(path)) continue;
      if (await writer.createNew(path, content)) return { path };
    }
    throw deepResearchRejected(
      "research-export-name",
      `Every export name for this report is taken after ${MAX_EXPORT_NAME_ATTEMPTS} attempts.`,
    );
  }
}

function registrySources(
  registry: ConversationSourceRegistry,
  markdown: string,
): Map<string, SourceReference> {
  const tokens = [...markdown.matchAll(new RegExp(CITATION_TOKEN_SOURCE, "gu"))].map(
    (match) => match[1]!,
  );
  const sources = new Map<string, SourceReference>();
  for (const token of new Set(tokens)) {
    const source = resolveConversationEvidence(registry, [token])[0]?.source;
    if (source) sources.set(token, source);
  }
  return sources;
}
