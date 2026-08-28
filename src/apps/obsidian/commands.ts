import { Notice } from "obsidian";
import type { Command, Editor, MarkdownFileInfo } from "obsidian";

import type { Translate } from "@adapters/i18n";
import { toUserMessage } from "@core/errors";
import type { AttestChatCommandAction } from "@apps/obsidian/ui/chat";

export const ATTEST_COMMAND_IDS = [
  "open-attest-chat",
  "ask-current-note",
  "ask-selected-text",
  "find-related-notes",
  "update-index",
  "summarize-current-note",
] as const;

export interface AttestCommandHost {
  addCommand(command: Command): Command;
  t: Translate;
  openChat(): Promise<void>;
  runChatCommand(action: AttestChatCommandAction): Promise<void>;
  updateActiveIndex(): Promise<void>;
}

export function registerAttestCommands(host: AttestCommandHost): void {
  host.addCommand({
    id: "open-attest-chat",
    name: host.t("command.openChat"),
    icon: "bot-message-square",
    callback: () => runSafely(() => host.openChat()),
  });
  host.addCommand(
    editorCommand(host, {
      id: "ask-current-note",
      name: host.t("command.askCurrentNote"),
      icon: "message-circle-question",
      action: (_editor, path) => ({
        contextPaths: [path],
        submit: false,
      }),
    }),
  );
  host.addCommand(
    editorCommand(host, {
      id: "ask-selected-text",
      name: host.t("command.askSelectedText"),
      icon: "text-select",
      requireSelection: true,
      action: (editor, path) => ({
        contextPaths: [path],
        question: host.t("command.prompt.selectedText", {
          selection: quoteSelection(editor.getSelection().trim()),
        }),
        submit: false,
      }),
    }),
  );
  host.addCommand(
    editorCommand(host, {
      id: "find-related-notes",
      name: host.t("command.findRelatedNotes"),
      icon: "waypoints",
      action: (_editor, path) => ({
        contextPaths: [path],
        question: host.t("command.prompt.relatedNotes"),
        searchMode: "indexOnly",
        submit: true,
      }),
    }),
  );
  host.addCommand({
    id: "update-index",
    name: host.t("command.updateIndex"),
    icon: "refresh-cw",
    callback: () => runSafely(() => host.updateActiveIndex()),
  });
  host.addCommand(
    editorCommand(host, {
      id: "summarize-current-note",
      name: host.t("command.summarizeCurrentNote"),
      icon: "list-collapse",
      action: (_editor, path) => ({
        contextPaths: [path],
        question: host.t("command.prompt.summarizeNote"),
        searchMode: "none",
        submit: true,
      }),
    }),
  );
}

function editorCommand(
  host: AttestCommandHost,
  options: {
    id: string;
    name: string;
    icon: string;
    requireSelection?: boolean;
    action(editor: Editor, path: string): AttestChatCommandAction;
  },
): Command {
  return {
    id: options.id,
    name: options.name,
    icon: options.icon,
    editorCheckCallback: (checking, editor, context) => {
      const path = markdownPath(context);
      if (!path) return false;
      if (options.requireSelection && !editor.getSelection().trim()) return false;
      if (!checking) runSafely(() => host.runChatCommand(options.action(editor, path)));
      return true;
    },
  };
}

function markdownPath(context: MarkdownFileInfo): string | null {
  const file = context.file;
  return file?.extension.toLowerCase() === "md" ? file.path : null;
}

function quoteSelection(selection: string): string {
  return selection
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function runSafely(action: () => Promise<void>): void {
  void action().catch((error) => new Notice(toUserMessage(error)));
}
