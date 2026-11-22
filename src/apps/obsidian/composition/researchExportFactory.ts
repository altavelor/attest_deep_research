import { ObsidianResearchNoteWriter } from "@adapters/obsidian/ObsidianResearchNoteWriter";
import {
  ResearchExportService,
  type ResearchExportContext,
} from "@application/use-cases/research/deep-research";
import type { CompositionContext } from "./CompositionContext";

/** Builds the export of one finished research of a chat, reading the folder setting per export. */
export function createResearchExportService(
  ctx: CompositionContext,
  context: ResearchExportContext,
): ResearchExportService {
  return new ResearchExportService({
    writer: new ObsidianResearchNoteWriter(ctx.app),
    defaultFolder: () => ctx.getSettings().researchExportFolder,
    now: () => new Date(),
    context,
  });
}
