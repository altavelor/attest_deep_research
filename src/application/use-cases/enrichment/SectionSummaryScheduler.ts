import { DocumentSummarizer, SectionSummary } from "@application/ports";
import { SectionSummaryGroup } from "./SectionSummaryPlanner";

export const DEFAULT_SECTION_SUMMARY_CONCURRENCY = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 500;

const MAX_SECTION_SUMMARY_ATTEMPTS = 3;

export async function summarizeSectionGroups(options: {
  summarizer: DocumentSummarizer;
  sourcePath: string;
  groups: SectionSummaryGroup[];
  previousByHash: Map<string, SectionSummary>;
  concurrency: number;
  retryBackoffMs: number;
  onProgress?: (progress: { sectionIndex: number; sectionCount: number }) => void;
}): Promise<SectionSummary[]> {
  const results: Array<SectionSummary | undefined> = new Array(options.groups.length);
  let next = 0;
  let completed = 0;
  let active = 0;
  let limit = Math.min(options.concurrency, Math.max(options.groups.length, 1));

  return await new Promise<SectionSummary[]>((resolve, reject) => {
    const resolveWhenDone = () => {
      if (completed >= options.groups.length) {
        resolve(results.filter((section): section is SectionSummary => Boolean(section)));
        return true;
      }
      return false;
    };

    const launch = () => {
      while (active < limit && next < options.groups.length) {
        const index = next;
        next += 1;
        const group = options.groups[index];
        const cached = options.previousByHash.get(group.sectionHash);
        if (cached) {
          results[index] = {
            headingPath: group.headingPath,
            chunkStart: group.chunkStart,
            chunkEnd: group.chunkEnd,
            sectionHash: group.sectionHash,
            summary: cached.summary,
          };
          completed += 1;
          continue;
        }

        active += 1;
        options.onProgress?.({
          sectionIndex: completed + active,
          sectionCount: options.groups.length,
        });
        summarizeSectionWithRetry({
          summarizer: options.summarizer,
          sourcePath: options.sourcePath,
          group,
          retryBackoffMs: options.retryBackoffMs,
          onRateLimit: () => {
            limit = Math.max(1, limit - 1);
          },
        })
          .then((summary) => {
            results[index] = summary;
            completed += 1;
            active -= 1;
            if (!resolveWhenDone()) {
              launch();
            }
          })
          .catch(reject);
      }
      resolveWhenDone();
    };

    launch();
  });
}

async function summarizeSectionWithRetry(options: {
  summarizer: DocumentSummarizer;
  sourcePath: string;
  group: SectionSummaryGroup;
  retryBackoffMs: number;
  onRateLimit: () => void;
}): Promise<SectionSummary> {
  let attempt = 0;
  while (true) {
    try {
      const summary = await options.summarizer.summarizeSection({
        sourcePath: options.sourcePath,
        headingPath: options.group.headingPath,
        text: options.group.text,
      });
      return {
        headingPath: options.group.headingPath,
        chunkStart: options.group.chunkStart,
        chunkEnd: options.group.chunkEnd,
        sectionHash: options.group.sectionHash,
        summary,
      };
    } catch (error) {
      attempt += 1;
      if (isRateLimitError(error)) {
        options.onRateLimit();
      }
      if (attempt >= MAX_SECTION_SUMMARY_ATTEMPTS || !isRetryableSummaryError(error)) {
        throw error;
      }
      await wait(options.retryBackoffMs * attempt);
    }
  }
}

function isRetryableSummaryError(error: unknown): boolean {
  if (isRateLimitError(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|temporar|network|econnreset|etimedout|503|502|504/i.test(message);
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|too many requests/i.test(message);
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
