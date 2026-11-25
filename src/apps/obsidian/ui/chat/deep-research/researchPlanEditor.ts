import type { Translate } from "@adapters/i18n";
import type { ResearchPlanEditRequest } from "@application/use-cases/chat";
import {
  MAX_RESEARCH_BRANCHES,
  MAX_RESEARCH_TEXT_CHARS,
  maxEnabledBranches,
  type ResearchBranch,
  type ResearchPlan,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { renderOmissionsEditor } from "./researchOmissionsEditor";
import { DISABLED_BRANCH, branchClass, dependencyNote, renderPlanHeader } from "./researchPlanView";

const MAX_TITLE_CHARS = 200;

interface EditorRow {
  itemEl: HTMLLIElement;
  branch: ResearchBranch | null;
  enabled: HTMLInputElement | null;
  title: HTMLInputElement;
  task: HTMLTextAreaElement;
  priority: HTMLSelectElement | null;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
}

/**
 * Renders the in-place editor of a pending plan. Branches can be switched off, renamed, rewritten,
 * reprioritised, reordered, deleted and added, known omissions edited, and saving commits one
 * manual edit; nothing changes until then.
 */
export function renderPlanEditor(
  parentEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
  onCancel: () => void,
): void {
  const { t } = context;
  renderPlanHeader(parentEl, plan, t);
  const listEl = parentEl.createEl("ol", { cls: "attest-research-card__branches" });
  const rows: EditorRow[] = [];
  const removed: string[] = [];
  const addEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const addButton = addEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t("chat.deepResearch.action.addBranch"),
  });
  const limitEl = addEl.createDiv({ cls: "attest-research-card__notice" });
  const maxEnabled = maxEnabledBranches(plan);
  const refresh = (): void => {
    const enabled = rows.filter((row) => row.enabled?.checked ?? true).length;
    const limit =
      rows.length >= MAX_RESEARCH_BRANCHES
        ? t("chat.deepResearch.editor.totalLimit", { max: MAX_RESEARCH_BRANCHES })
        : enabled >= maxEnabled
          ? t("chat.deepResearch.editor.enabledLimit", { max: maxEnabled })
          : "";
    addButton.disabled = limit !== "";
    limitEl.setText(limit);
    limitEl.toggleClass("attest-research-card__notice--error", enabled > maxEnabled);
    rows.forEach((row, index) => {
      row.up.disabled = index === 0;
      row.down.disabled = index === rows.length - 1;
    });
  };
  const move = (row: EditorRow, step: -1 | 1): void => {
    const from = rows.indexOf(row);
    const other = rows[from + step];
    if (!other) return;
    rows[from] = other;
    rows[from + step] = row;
    if (step < 0) listEl.insertBefore(row.itemEl, other.itemEl);
    else listEl.insertBefore(other.itemEl, row.itemEl);
    refresh();
  };
  const remove = (row: EditorRow): void => {
    rows.splice(rows.indexOf(row), 1);
    if (row.branch) removed.push(row.branch.branchId);
    row.itemEl.remove();
    refresh();
  };
  const addRow = (branch: ResearchBranch | null): EditorRow => {
    const row = renderRow(listEl, plan, branch, t, { move, remove, refresh });
    rows.push(row);
    return row;
  };
  for (const branch of plan.branches) addRow(branch);
  addButton.addEventListener("click", () => {
    if (addButton.disabled) return;
    const row = addRow(null);
    refresh();
    row.title.focus();
  });
  refresh();
  const omissions = renderOmissionsEditor(parentEl, plan.knownOmissions, t);
  renderSaveControls(parentEl, context, onCancel, () =>
    editRequest(state, rows, removed, omissions()),
  );
}

function renderRow(
  listEl: HTMLElement,
  plan: ResearchPlan,
  branch: ResearchBranch | null,
  t: Translate,
  actions: {
    move(row: EditorRow, step: -1 | 1): void;
    remove(row: EditorRow): void;
    refresh(): void;
  },
): EditorRow {
  const itemEl = listEl.createEl("li", { cls: branchClass(branch?.enabled ?? true) });
  const headEl = itemEl.createDiv({ cls: "attest-research-card__editor-row" });
  const enabled = branch ? headEl.createEl("input", { attr: { type: "checkbox" } }) : null;
  if (enabled) enabled.checked = branch!.enabled;
  const title = headEl.createEl("input", {
    cls: "attest-research-card__editor-title",
    attr: {
      type: "text",
      maxlength: String(MAX_TITLE_CHARS),
      placeholder: t("chat.deepResearch.editor.titlePlaceholder"),
    },
  });
  title.value = branch?.title ?? "";
  const priority = branch ? headEl.createEl("select", { cls: "dropdown" }) : null;
  if (priority) {
    priority.createEl("option", { value: "required", text: t("chat.deepResearch.card.required") });
    priority.createEl("option", { value: "optional", text: t("chat.deepResearch.card.optional") });
    priority.value = branch!.priority;
  }
  const button = (text: string, label: string): HTMLButtonElement =>
    headEl.createEl("button", {
      cls: "attest-research-card__action",
      text,
      attr: { "aria-label": label },
    });
  const up = button("↑", t("chat.deepResearch.editor.moveUp"));
  const down = button("↓", t("chat.deepResearch.editor.moveDown"));
  const deleteLabel = t("chat.deepResearch.action.removeBranch");
  const del = button(deleteLabel, deleteLabel);
  const task = itemEl.createEl("textarea", {
    cls: "attest-research-card__editor-task",
    attr: {
      maxlength: String(MAX_RESEARCH_TEXT_CHARS),
      placeholder: t("chat.deepResearch.editor.taskPlaceholder"),
    },
  });
  task.value = branch?.task ?? "";
  const note = branch ? dependencyNote(plan, branch, t) : "";
  if (note) itemEl.createDiv({ cls: "attest-research-card__branch-notes", text: note });
  const row: EditorRow = { itemEl, branch, enabled, title, task, priority, up, down };
  enabled?.addEventListener("change", () => {
    itemEl.toggleClass(DISABLED_BRANCH, !enabled.checked);
    actions.refresh();
  });
  up.addEventListener("click", () => actions.move(row, -1));
  down.addEventListener("click", () => actions.move(row, 1));
  del.addEventListener("click", () => actions.remove(row));
  return row;
}

function editRequest(
  state: ResearchState,
  rows: readonly EditorRow[],
  removed: readonly string[],
  knownOmissions: readonly string[],
): ResearchPlanEditRequest {
  const kept = rows.filter(
    (row) => row.branch || row.title.value.trim() !== "" || row.task.value.trim() !== "",
  );
  const added = kept.filter((row) => !row.branch);
  return {
    researchId: state.researchId,
    decisionId: state.pending!.decisionId,
    expectedRevision: state.revision,
    branches: kept.flatMap((row) =>
      row.branch
        ? [
            {
              branchId: row.branch.branchId,
              enabled: row.enabled!.checked,
              title: row.title.value,
              task: row.task.value,
              priority: row.priority!.value === "optional" ? "optional" : "required",
            } as const,
          ]
        : [],
    ),
    added: added.map((row) => ({ title: row.title.value, task: row.task.value })),
    removed,
    order: kept.map((row) => row.branch?.branchId ?? added.indexOf(row)),
    knownOmissions,
  };
}

function renderSaveControls(
  parentEl: HTMLElement,
  context: ResearchCardContext,
  onCancel: () => void,
  request: () => ResearchPlanEditRequest,
): void {
  let errorEl: HTMLElement | null = null;
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const save = actionsEl.createEl("button", {
    cls: "attest-research-card__action mod-cta",
    text: context.t("chat.deepResearch.action.save"),
  });
  const cancel = actionsEl.createEl("button", {
    cls: "attest-research-card__action",
    text: context.t("chat.deepResearch.action.cancelEdit"),
  });
  cancel.addEventListener("click", onCancel);
  save.addEventListener("click", () => {
    if (save.disabled || !context.onEditPlan) return;
    save.disabled = true;
    cancel.disabled = true;
    void context.onEditPlan(request()).then((result) => {
      if (result.ok) return;
      if (!errorEl) {
        errorEl = parentEl.createDiv({
          cls: "attest-research-card__notice attest-research-card__notice--error",
        });
        parentEl.insertBefore(errorEl, actionsEl);
      }
      errorEl.setText(context.t("chat.deepResearch.editFailed", { reason: result.message }));
      save.disabled = false;
      cancel.disabled = false;
    });
  });
}
