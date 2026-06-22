import { ModelStreamEvent } from "../../shared/types";

const DEFAULT_TAG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["<think>", "</think>"],
  ["<thinking>", "</thinking>"],
  ["<analysis>", "</analysis>"],
  ["<reasoning>", "</reasoning>"],
  ["<reflection>", "</reflection>"],
];

export interface InlineReasoningParserOptions {
  tagPairs?: ReadonlyArray<readonly [string, string]>;
  segmentId?: string;
}

export class InlineReasoningParser {
  private readonly pairs: ReadonlyArray<readonly [string, string]>;
  private readonly segmentId: string;
  private buffer = "";
  private activePair?: readonly [string, string];
  private activeSegmentId?: string;
  private segmentIndex = 0;
  private started = false;

  constructor(options: InlineReasoningParserOptions = {}) {
    this.pairs = options.tagPairs ?? DEFAULT_TAG_PAIRS;
    this.segmentId = options.segmentId ?? "reasoning-inline-0";
  }

  push(chunk: string): ModelStreamEvent[] {
    if (!chunk) return [];
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): ModelStreamEvent[] {
    const events = this.drain(true);
    if (this.activePair && this.started && this.activeSegmentId) {
      events.push({ type: "reasoning-end", segmentId: this.activeSegmentId });
    }
    this.activePair = undefined;
    this.activeSegmentId = undefined;
    this.started = false;
    return events;
  }

  private drain(final: boolean): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    while (this.buffer) {
      if (this.activePair) {
        const close = this.activePair[1];
        const index = this.buffer.indexOf(close);
        if (index >= 0) {
          this.emitReasoning(events, this.buffer.slice(0, index));
          this.buffer = this.buffer.slice(index + close.length);
          events.push({ type: "reasoning-end", segmentId: this.activeSegmentId! });
          this.activePair = undefined;
          this.activeSegmentId = undefined;
          this.started = false;
          continue;
        }
        const safeLength = final ? this.buffer.length : safePrefixLength(this.buffer, [close]);
        if (safeLength === 0) break;
        this.emitReasoning(events, this.buffer.slice(0, safeLength));
        this.buffer = this.buffer.slice(safeLength);
        continue;
      }

      const opening = findFirstMarker(this.buffer, this.pairs);
      if (opening) {
        if (opening.index > 0) {
          events.push({ type: "text-delta", text: this.buffer.slice(0, opening.index) });
        }
        this.buffer = this.buffer.slice(opening.index + opening.pair[0].length);
        this.activePair = opening.pair;
        this.activeSegmentId =
          this.segmentIndex === 0 ? this.segmentId : `${this.segmentId}-${this.segmentIndex}`;
        this.segmentIndex += 1;
        this.started = true;
        events.push({
          type: "reasoning-start",
          segmentId: this.activeSegmentId,
          visibility: "text",
        });
        continue;
      }
      const markers = this.pairs.map(([open]) => open);
      const safeLength = final ? this.buffer.length : safePrefixLength(this.buffer, markers);
      if (safeLength === 0) break;
      events.push({ type: "text-delta", text: this.buffer.slice(0, safeLength) });
      this.buffer = this.buffer.slice(safeLength);
    }
    return events;
  }

  private emitReasoning(events: ModelStreamEvent[], text: string): void {
    if (text) events.push({ type: "reasoning-delta", segmentId: this.activeSegmentId!, text });
  }
}

function findFirstMarker(
  value: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): { index: number; pair: readonly [string, string] } | undefined {
  let found: { index: number; pair: readonly [string, string] } | undefined;
  for (const pair of pairs) {
    const index = value.indexOf(pair[0]);
    if (index >= 0 && (!found || index < found.index)) found = { index, pair };
  }
  return found;
}

function safePrefixLength(value: string, markers: string[]): number {
  let retained = 0;
  for (const marker of markers) {
    const limit = Math.min(value.length, marker.length - 1);
    for (let length = limit; length > retained; length -= 1) {
      if (marker.startsWith(value.slice(-length))) {
        retained = length;
        break;
      }
    }
  }
  return value.length - retained;
}
