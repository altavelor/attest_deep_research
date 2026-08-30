import {
  CREATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  DOWNLOAD_DOCUMENT_TOOL,
  LIST_NOTES_TOOL,
  PROBE_DOCUMENT_URL_TOOL,
  READ_NOTE_TOOL,
  UPDATE_NOTE_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from "@core/agent/toolNames";
import { PromptCapabilities, registered } from "./promptCapabilities";

/** Level two: the safe-mutation policy for the note tools a profile registered. */
export function buildSafeMutationPolicy(capabilities: PromptCapabilities): string {
  const mutation = registered(capabilities.tools, [
    CREATE_NOTE_TOOL,
    UPDATE_NOTE_TOOL,
    DELETE_NOTE_TOOL,
  ]);
  const verify = registered(capabilities.tools, [LIST_NOTES_TOOL, READ_NOTE_TOOL]);

  const lines = [
    `## Note mutation rules (${mutation.join(", ")})`,
    "- Call a mutation tool only when the user explicitly asked for a write action.",
  ];
  if (capabilities.tools.has(UPDATE_NOTE_TOOL)) {
    lines.push(
      "- Prefer append or prepend over replace: replace destroys the existing content of the note.",
    );
    if (verify.length > 0) {
      lines.push(
        `- Confirm the file exists with ${verify.join(" or ")} before calling ${UPDATE_NOTE_TOOL}.`,
      );
    }
    lines.push(
      `- On {ok:false, reason:"not-found"}: call ${CREATE_NOTE_TOOL} first, then ${UPDATE_NOTE_TOOL} if needed.`,
    );
  }
  if (capabilities.tools.has(CREATE_NOTE_TOOL)) {
    lines.push(
      '- On {ok:false, reason:"already-exists"}: read the existing note and append or prepend ' +
        "safely, choose another path, or ask for explicit confirmation before replacing any content.",
    );
  }
  lines.push(
    "- Never overwrite or delete on your own inference about what the user meant.",
    "- Never write to .attest/ paths.",
  );
  return lines.join("\n");
}

/** Level two: dating rule for claims written into artefacts that outlive the chat. */
export const ARTIFACT_DURABILITY_POLICY = `
## Notes outlive the question
A chat answer lives for minutes; a note lives for years. Inside a note you create or
update, a claim of one of these kinds carries its measure and its as-of date, not just
the fact: superlatives and rankings ("largest", "best", "first"); quantities and prices;
positions and roles; statuses ("current", "acting"); and any claim the request phrases in
the present tense about the state of the world.
Replace moment-bound wording ("now", "latest") with the dated form. The granularity is
the claim, not the document: some lines in a note are dated, others are not — dating
everything is noise. When in doubt, date it.`.trimStart();

/** Level five: how to save a document, or the one-line reminder when that is not the task. */
export function buildDownloadSection(capabilities: PromptCapabilities, wanted: boolean): string {
  const probe = capabilities.downloadProbe;
  const heading = probe
    ? `## Downloading documents (${PROBE_DOCUMENT_URL_TOOL}, ${DOWNLOAD_DOCUMENT_TOOL})`
    : `## Downloading documents (${DOWNLOAD_DOCUMENT_TOOL})`;

  if (!wanted) {
    return [
      heading,
      `${DOWNLOAD_DOCUMENT_TOOL} saves a file into the vault. Call it only when the user asked ` +
        "to save a document; it is not a way to read one.",
    ].join("\n");
  }

  const finder = registered(capabilities.tools, [WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
  const steps = [
    "Use these when the user asks you to save a file (PDF and similar) into the vault.",
    `- Real side effect: the file exists only after ${DOWNLOAD_DOCUMENT_TOOL} returns {ok:true}.`,
  ];
  const findStep =
    finder.length > 0 ? `Find the file's direct URL with ${finder.join(" / ")}` : "Find the URL";
  if (probe) {
    steps.push(
      `- ${findStep}, then call ${PROBE_DOCUMENT_URL_TOOL} to confirm it is a downloadable`,
      "  document (check `downloadable`, `contentType`, `suggestedFilename`). Pass `urls` to probe",
      "  several candidates in one call.",
      `- Only then call ${DOWNLOAD_DOCUMENT_TOOL} with the confirmed URL.`,
    );
  } else {
    steps.push(`- ${findStep}, then call ${DOWNLOAD_DOCUMENT_TOOL} with it.`);
  }
  steps.push(
    "- Set `path` to a vault folder ending in '/' to group related downloads; the filename is",
    "  derived automatically, extension included.",
    `- ${DOWNLOAD_DOCUMENT_TOOL} needs user confirmation and may be declined; if it fails or is`,
    "  cancelled, report that the file was NOT saved.",
  );

  return [heading, steps.join("\n")].join("\n");
}
