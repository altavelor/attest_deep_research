import { ChatMessage } from "@core/agent/protocol";
import {
  CHECK_URLS_TOOL,
  CREATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  DOWNLOAD_DOCUMENT_TOOL,
  FIND_CLAIMS_TOOL,
  IMAGE_SEARCH_TOOL,
  INDEX_SEARCH_TOOL,
  LIST_INDEX_URLS_TOOL,
  MAP_SOURCES_TOOL,
  NOTE_EDIT_TOOLS,
  PRESENT_CHART_TOOL,
  PRESENT_IMAGE_GALLERY_TOOL,
  PROBE_DOCUMENT_URL_TOOL,
  SUB_AGENT_TOOL,
  UPDATE_NOTE_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from "@core/agent/toolNames";
import { RetrievedChunk } from "@core/model/source";
import type { ConversationRegistryPromptView } from "@core/chat/sourceRegistry";
import { AttachedFileManifestEntry, buildAttachmentManifestSection } from "./attachments";
import { currentDateLine, ResearchChatHistoryMessage } from "./prompts";
import {
  ARTIFACT_DURABILITY_POLICY,
  buildDownloadSection,
  buildSafeMutationPolicy,
} from "./thinking-prompt/promptActions";
import {
  PromptCapabilities,
  registered,
  resolvePromptCapabilities,
} from "./thinking-prompt/promptCapabilities";
import { classifyPromptIntent, PromptIntent } from "./thinking-prompt/promptIntent";
import {
  ACTION_HONESTY_POLICY,
  buildCitationPolicy,
  buildEvidenceModelPolicy,
  buildIdentitySection,
  buildLoopEconomyPolicy,
  DELIVERABLE_CONTRACT_POLICY,
  FINAL_CHECK_POLICY,
  PROPORTIONALITY_POLICY,
  SOURCE_SELECTION_POLICY,
  TOOL_FAILURE_POLICY,
} from "./thinking-prompt/promptPolicy";
import {
  assemblePromptSections,
  optionalSection,
  PromptAssemblyIssue,
  PromptSection,
  section,
} from "./thinking-prompt/promptSection";
import {
  buildIndexDescriptionSection,
  buildIndexSection,
  buildIndexUrlAuditSection,
  buildSourceAvailabilityRule,
  buildWebSection,
} from "./thinking-prompt/promptSources";
import {
  buildConversationRegistrySection,
  buildExplicitEvidenceSection,
} from "./thinking-prompt/promptUntrustedData";
import {
  buildCompileKnowledgeSection,
  buildFindClaimsSection,
  buildMapSourcesSection,
  buildRichMediaSection,
  buildSubAgentSection,
  buildVaultNavigationSection,
} from "./thinking-prompt/promptWorkflows";

export interface ThinkingToolContext {
  coreVariant: "vault" | "research";
  availableTools: readonly string[];
  indexDescription?: string;

  parallelToolCalls?: boolean;
}

export interface BuildThinkingResearchMessagesOptions {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  requiredTools: readonly string[];
  explicitEvidence?: RetrievedChunk[];
  conversationRegistry?: ConversationRegistryPromptView;

  attachedFiles?: AttachedFileManifestEntry[];
  toolContext: ThinkingToolContext;

  now?: Date;

  onAssemblyIssue?: (issue: PromptAssemblyIssue) => void;
}

/**
 * Builds the ordered prompt sections for a profile. Exposed for tests and for the
 * token-budget measurement; the section list is the contract, the joined text is not.
 */
export function buildThinkingPromptSections(
  options: BuildThinkingResearchMessagesOptions,
): PromptSection[] {
  const { toolContext } = options;
  const capabilities = resolvePromptCapabilities({
    availableTools: toolContext.availableTools,
    ...(toolContext.parallelToolCalls !== undefined
      ? { parallelToolCalls: toolContext.parallelToolCalls }
      : {}),
  });
  const intent = classifyPromptIntent({
    question: options.question,
    requiredTools: options.requiredTools,
  });

  return [
    ...policySections(options, capabilities),
    ...workflowSections(capabilities, intent),
    ...untrustedSections(options, capabilities),
  ];
}

function policySections(
  options: BuildThinkingResearchMessagesOptions,
  capabilities: PromptCapabilities,
): PromptSection[] {
  return [
    section(
      "identity",
      "policy",
      buildIdentitySection({
        currentDateLine: currentDateLine(options.now),
        requiredTools: options.requiredTools,
        parallelToolCalls: capabilities.parallelToolCalls,
      }),
    ),
    section("action-honesty", "policy", ACTION_HONESTY_POLICY),
    section("deliverable-contract", "policy", DELIVERABLE_CONTRACT_POLICY),
    section("proportionality", "policy", PROPORTIONALITY_POLICY),
    section("evidence-model", "policy", buildEvidenceModelPolicy(capabilities)),
    optionalSection(
      "source-selection",
      "policy",
      capabilities.web || capabilities.index,
      () => SOURCE_SELECTION_POLICY,
    ),
    optionalSection(
      "citation-policy",
      "policy",
      capabilities.web || capabilities.index || capabilities.noteRead,
      () => buildCitationPolicy(capabilities),
    ),
    section(
      "source-availability",
      "policy",
      buildSourceAvailabilityRule(capabilities.web, capabilities.index),
    ),
    optionalSection(
      "safe-mutations",
      "policy",
      capabilities.noteMutation,
      () => buildSafeMutationPolicy(capabilities),
      registered(capabilities.tools, [CREATE_NOTE_TOOL, UPDATE_NOTE_TOOL, DELETE_NOTE_TOOL]),
    ),
    optionalSection(
      "artifact-durability",
      "policy",
      capabilities.noteMutation,
      () => ARTIFACT_DURABILITY_POLICY,
    ),
    section("tool-failure", "policy", TOOL_FAILURE_POLICY),
    section("loop-economy", "policy", buildLoopEconomyPolicy(capabilities)),
    section("final-check", "policy", FINAL_CHECK_POLICY),
  ];
}

function workflowSections(capabilities: PromptCapabilities, intent: PromptIntent): PromptSection[] {
  return [
    optionalSection(
      "vault-navigation",
      "workflow",
      capabilities.noteRead,
      () => buildVaultNavigationSection(capabilities),
      registered(capabilities.tools, NOTE_EDIT_TOOLS),
    ),
    optionalSection(
      "index-usage",
      "workflow",
      capabilities.index,
      () => buildIndexSection(capabilities),
      [INDEX_SEARCH_TOOL],
    ),
    optionalSection(
      "index-url-audit",
      "workflow",
      capabilities.indexUrlAudit,
      () => buildIndexUrlAuditSection(capabilities),
      registered(capabilities.tools, [LIST_INDEX_URLS_TOOL, CHECK_URLS_TOOL]),
    ),
    optionalSection(
      "web-usage",
      "workflow",
      capabilities.web,
      () => buildWebSection(capabilities),
      registered(capabilities.tools, [WEB_SEARCH_TOOL, WEB_FETCH_TOOL]),
    ),
    optionalSection(
      "download",
      "workflow",
      capabilities.download,
      () => buildDownloadSection(capabilities, intent.download),
      registered(capabilities.tools, [DOWNLOAD_DOCUMENT_TOOL, PROBE_DOCUMENT_URL_TOOL]),
    ),
    optionalSection(
      "sub-agent",
      "workflow",
      capabilities.subAgent,
      () => buildSubAgentSection(capabilities),
      [SUB_AGENT_TOOL],
    ),
    optionalSection(
      "map-sources",
      "workflow",
      capabilities.mapSources,
      () => buildMapSourcesSection(intent.compareDocuments),
      [MAP_SOURCES_TOOL],
    ),
    optionalSection(
      "find-claims",
      "workflow",
      capabilities.findClaims,
      () => buildFindClaimsSection(capabilities, intent.findContradictions),
      [FIND_CLAIMS_TOOL],
    ),
    optionalSection(
      "compile-knowledge",
      "workflow",
      capabilities.index && capabilities.noteMutation && intent.compileKnowledge,
      () => buildCompileKnowledgeSection(capabilities),
      registered(capabilities.tools, [INDEX_SEARCH_TOOL, CREATE_NOTE_TOOL, UPDATE_NOTE_TOOL]),
    ),
    optionalSection(
      "rich-media",
      "workflow",
      capabilities.richMedia,
      () => buildRichMediaSection(capabilities, intent.showVisuals),
      registered(capabilities.tools, [
        IMAGE_SEARCH_TOOL,
        PRESENT_IMAGE_GALLERY_TOOL,
        PRESENT_CHART_TOOL,
      ]),
    ),
  ];
}

function untrustedSections(
  options: BuildThinkingResearchMessagesOptions,
  capabilities: PromptCapabilities,
): PromptSection[] {
  const indexDescription = options.toolContext.indexDescription;
  return [
    optionalSection(
      "index-description",
      "untrusted-data",
      capabilities.index && Boolean(indexDescription),
      () => buildIndexDescriptionSection(indexDescription ?? ""),
    ),
    optionalSection(
      "attachment-manifest",
      "untrusted-data",
      Boolean(options.attachedFiles?.length),
      () =>
        buildAttachmentManifestSection(options.attachedFiles ?? [], {
          noteToolsAvailable: capabilities.noteRead,
        }),
    ),
    optionalSection(
      "explicit-evidence",
      "untrusted-data",
      Boolean(options.explicitEvidence?.length),
      () => buildExplicitEvidenceSection(options.explicitEvidence ?? []),
    ),
    optionalSection(
      "conversation-registry",
      "untrusted-data",
      Boolean(options.conversationRegistry?.catalog.length),
      () => buildConversationRegistrySection(options.conversationRegistry!),
    ),
  ];
}

export function buildThinkingResearchMessages(
  options: BuildThinkingResearchMessagesOptions,
): ChatMessage[] {
  const assembled = assemblePromptSections(buildThinkingPromptSections(options), {
    availableTools: new Set(options.toolContext.availableTools),
  });
  for (const issue of assembled.issues) {
    options.onAssemblyIssue?.(issue);
  }

  return [
    { role: "system", content: assembled.text },
    ...(options.chatHistory ?? []).map((message) => ({ ...message })),
    { role: "user", content: options.question },
  ];
}
