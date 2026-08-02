// Attribution text for answer images. A licensed provider image and a plain
// page reference must never read the same: only images that came with provider
// licence metadata are described as licensed.

import type { AnswerImage } from "@core/media";

/** True when the image is only referenced by a page, with no licence metadata. */
export function isPageReference(image: AnswerImage): boolean {
  return image.licensed !== true && image.vaultSource === undefined;
}

export function attributionText(image: AnswerImage): string {
  if (image.vaultSource) {
    return `From ${image.sourceLabel}`;
  }
  if (image.licensed === true && image.licenceName) {
    return `${image.sourceLabel} · ${image.licenceName}`;
  }
  return `Referenced from ${image.sourceLabel}`;
}
