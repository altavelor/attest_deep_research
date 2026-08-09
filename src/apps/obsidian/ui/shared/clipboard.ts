import { Notice } from "obsidian";
import type { Translate } from "@adapters/i18n";

export async function copyToClipboard(value: string, t: Translate): Promise<void> {
  await navigator.clipboard.writeText(value);
  new Notice(t("common.copiedToClipboard"));
}
