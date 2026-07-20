/**
 * Detects degenerate repetition in a streamed text generation so a runaway model
 * (typically small/quantized local models that collapse into a sampling loop) can
 * be cut off instead of streaming the same block forever.
 *
 * It works on completed lines. Repetition is flagged when the tail of the stream
 * consists of the same block of `cycleLines` lines repeated at least `minRepeats`
 * times — this catches both a single line repeated (cycle 1) and a multi-line
 * block repeated (cycle > 1, e.g. an alternating two-line loop).
 */
export class RepetitionDetector {
  private pending = "";
  private readonly lines: string[] = [];

  constructor(
    private readonly minRepeats = 4,
    private readonly maxCycleLines = 6,
    private readonly minContentChars = 40,
  ) {}

  /** Feed the next streamed text fragment (token-sized fragments are fine). */
  push(text: string): void {
    this.pending += text;
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) !== -1) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line.length === 0) continue;
      this.lines.push(line);
      const cap = this.maxCycleLines * this.minRepeats + 2;
      if (this.lines.length > cap) this.lines.splice(0, this.lines.length - cap);
    }
  }

  /** True once the tail of the stream is a block repeated minRepeats times. */
  isRepeating(): boolean {
    for (let cycle = 1; cycle <= this.maxCycleLines; cycle += 1) {
      const needed = cycle * this.minRepeats;
      if (this.lines.length < needed) continue;
      const tail = this.lines.slice(this.lines.length - needed);
      if (tail.join("").length < this.minContentChars) continue;
      let repeating = true;
      for (let i = cycle; i < needed && repeating; i += 1) {
        if (tail[i] !== tail[i % cycle]) repeating = false;
      }
      if (repeating) return true;
    }
    return false;
  }
}
