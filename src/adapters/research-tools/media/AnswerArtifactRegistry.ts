// Per-run registry of image candidates and produced artifacts. Candidate ids
// are opaque handles valid only inside the current answer, so the model can
// never present an arbitrary URL — it can only reference something a tool
// already discovered in this run.

import {
  AnswerArtifact,
  ARTIFACT_LIMITS,
  ImageCandidate,
  ImageCandidateOrigin,
  isAnswerArtifact,
  toAnswerImage,
} from "@core/media";

const MAX_CANDIDATES = 60;
const MAX_ARTIFACTS = 6;

export interface RegisteredImageCandidate {
  handle: string;
  candidate: ImageCandidate;
}

export class AnswerArtifactRegistry {
  private readonly candidates = new Map<string, ImageCandidate>();
  private readonly handleByCandidateId = new Map<string, string>();
  private readonly artifacts: AnswerArtifact[] = [];
  private nextHandle = 1;

  /** Registers candidates and returns their per-run handles, deduplicated. */
  register(candidates: readonly ImageCandidate[]): RegisteredImageCandidate[] {
    const registered: RegisteredImageCandidate[] = [];
    for (const candidate of candidates) {
      if (this.candidates.size >= MAX_CANDIDATES) break;
      const existing = this.handleByCandidateId.get(candidate.id);
      if (existing) {
        registered.push({ handle: existing, candidate: this.candidates.get(existing)! });
        continue;
      }
      if (!toAnswerImage(candidate)) continue;
      const handle = `img_${this.nextHandle}`;
      this.nextHandle += 1;
      this.candidates.set(handle, candidate);
      this.handleByCandidateId.set(candidate.id, handle);
      registered.push({ handle, candidate });
    }
    return registered;
  }

  resolve(handle: string): ImageCandidate | undefined {
    return this.candidates.get(handle);
  }

  hasCandidates(): boolean {
    return this.candidates.size > 0;
  }

  /**
   * Candidates registered earlier in this run, newest first. Pages fetched with
   * fetch_web_page register their images here, so image search can surface them
   * even when no provider returned anything.
   */
  registeredByOrigin(origin: ImageCandidateOrigin): RegisteredImageCandidate[] {
    return [...this.candidates.entries()]
      .filter(([, candidate]) => candidate.origin === origin)
      .map(([handle, candidate]) => ({ handle, candidate }))
      .reverse();
  }

  /** Adds an artifact, ignoring anything that fails the DTO contract. */
  add(artifact: AnswerArtifact): boolean {
    if (this.artifacts.length >= MAX_ARTIFACTS) return false;
    if (!isAnswerArtifact(artifact)) return false;
    this.artifacts.push(artifact);
    return true;
  }

  nextArtifactId(prefix: string): string {
    return `${prefix}_${this.artifacts.length + 1}`;
  }

  snapshot(): AnswerArtifact[] | undefined {
    return this.artifacts.length > 0
      ? this.artifacts.map((artifact) => ({ ...artifact }))
      : undefined;
  }
}

export const GALLERY_LIMITS = {
  maxImages: ARTIFACT_LIMITS.galleryImages,
} as const;
