export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

const CONTEXT_LINES = 2;

/**
 * Produce a line-level diff between two texts, grouped into hunks that contain
 * only the changed regions plus a couple of context lines on each side. Long
 * runs of unchanged lines between hunks are omitted, mirroring how code review
 * tools show "only the changed chunks".
 */
export function computeLineDiff(before: string, after: string): DiffHunk[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const script = diffLines(beforeLines, afterLines);

  const keep = new Array<boolean>(script.length).fill(false);
  for (let i = 0; i < script.length; i += 1) {
    if (script[i].type !== "context") {
      for (
        let j = Math.max(0, i - CONTEXT_LINES);
        j <= Math.min(script.length - 1, i + CONTEXT_LINES);
        j += 1
      ) {
        keep[j] = true;
      }
    }
  }

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  for (let i = 0; i < script.length; i += 1) {
    if (keep[i]) {
      if (!current) {
        current = [];
        hunks.push({ lines: current });
      }
      current.push(script[i]);
    } else {
      current = null;
    }
  }
  return hunks;
}

export function diffHasChanges(hunks: DiffHunk[]): boolean {
  return hunks.some((hunk) => hunk.lines.some((line) => line.type !== "context"));
}

function splitLines(value: string): string[] {
  if (value === "") return [];
  return value.replace(/\r\n/g, "\n").split("\n");
}

/** Classic LCS-based line diff. Inputs are bounded (capped upstream), so O(n*m) is fine. */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "context", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: "remove", text: a[i] });
      i += 1;
    } else {
      result.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ type: "remove", text: a[i] });
    i += 1;
  }
  while (j < m) {
    result.push({ type: "add", text: b[j] });
    j += 1;
  }
  return result;
}
