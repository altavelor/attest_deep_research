import type { AnswerImage } from "@core/media";
import type { Translate } from "@adapters/i18n";

/** True when the image is only referenced by a page, with no licence metadata. */
export function isPageReference(image: AnswerImage): boolean {
  return image.licensed !== true && image.vaultSource === undefined;
}

export function attributionText(image: AnswerImage, t: Translate): string {
  if (image.vaultSource) {
    return t("chat.artifact.attribution.vault", { source: image.sourceLabel });
  }
  if (image.licensed === true && image.licenceName) {
    return t("chat.artifact.attribution.licensed", {
      source: image.sourceLabel,
      licence: image.licenceName,
    });
  }
  return t("chat.artifact.attribution.referenced", { source: image.sourceLabel });
}
