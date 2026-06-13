import { Notice } from "obsidian";

export async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  new Notice("Copied to clipboard.");
}
