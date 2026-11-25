import {
  MAX_RESEARCH_BRANCHES,
  MAX_RESEARCH_TEXT_CHARS,
  type PlanBranchAddition,
  type ResearchPlan,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { renderPlan } from "./researchPlanView";

const DISABLED_BRANCH = "attest-research-card__branch--disabled";
const MAX_TITLE_CHARS = 200;

interface BranchField {
  branchId: string;
  enabled: HTMLInputElement;
  task: HTMLTextAreaElement;
}

interface AddedField {
  title: HTMLInputElement;
  task: HTMLTextAreaElement;
}

/**
 * Renders the in-place plan editor of a pending plan. Unchecking a branch strikes it through at
 * once, new branches can be added and removed before saving, and saving commits one manual edit.
 */
export function renderPlanEditor(
  parentEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
  onCancel: () => void,
): void {
  const { t } = context;
  const fields: BranchField[] = [];
  const added: AddedField[] = [];
  const listEl = renderPlan(parentEl, plan, t, (itemEl, branch) => {
    const labelEl = itemEl.createEl("label", { cls: "attest-research-card__branch-title" });
    const enabled = labelEl.createEl("input", { attr: { type: "checkbox" } });
    enabled.checked = branch.enabled;
    enabled.addEventListener("change", () => itemEl.toggleClass(DISABLED_BRANCH, !enabled.checked));
    labelEl.appendText(` ${branch.title}`);
    fields.push({ branchId: branch.branchId, enabled, task: taskField(itemEl, branch.task) });
  });
  const maxBranches = Math.min(MAX_RESEARCH_BRANCHES, plan.limits.branches);
  const addEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const addButton = addEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t("chat.deepResearch.action.addBranch"),
  });
  const refreshAdd = (): void => {
    addButton.disabled = fields.length + added.length >= maxBranches;
  };
  refreshAdd();
  addButton.addEventListener("click", () => {
    if (addButton.disabled) return;
    const itemEl = listEl.createEl("li", { cls: "attest-research-card__branch" });
    const title = itemEl.createEl("input", {
      cls: "attest-research-card__editor-title",
      attr: {
        type: "text",
        maxlength: String(MAX_TITLE_CHARS),
        placeholder: t("chat.deepResearch.editor.titlePlaceholder"),
      },
    });
    const task = taskField(itemEl, "");
    task.placeholder = t("chat.deepResearch.editor.taskPlaceholder");
    const field = { title, task };
    added.push(field);
    const remove = itemEl.createEl("button", {
      cls: "attest-research-card__action",
      text: t("chat.deepResearch.action.removeBranch"),
    });
    remove.addEventListener("click", () => {
      added.splice(added.indexOf(field), 1);
      itemEl.remove();
      refreshAdd();
    });
    refreshAdd();
    title.focus();
  });
  let errorEl: HTMLElement | null = null;
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const save = actionsEl.createEl("button", {
    cls: "attest-research-card__action mod-cta",
    text: t("chat.deepResearch.action.save"),
  });
  const cancel = actionsEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t("chat.deepResearch.action.cancelEdit"),
  });
  cancel.addEventListener("click", onCancel);
  save.addEventListener("click", () => {
    if (save.disabled || !context.onEditPlan) return;
    save.disabled = true;
    cancel.disabled = true;
    void context
      .onEditPlan({
        researchId: state.researchId,
        decisionId: state.pending!.decisionId,
        expectedRevision: state.revision,
        branches: fields.map((field) => ({
          branchId: field.branchId,
          enabled: field.enabled.checked,
          task: field.task.value,
        })),
        added: additions(added),
      })
      .then((result) => {
        if (result.ok) return;
        if (!errorEl) {
          errorEl = parentEl.createDiv({
            cls: "attest-research-card__notice attest-research-card__notice--error",
          });
          parentEl.insertBefore(errorEl, actionsEl);
        }
        errorEl.setText(t("chat.deepResearch.editFailed", { reason: result.message }));
        save.disabled = false;
        cancel.disabled = false;
      });
  });
}

function taskField(itemEl: HTMLElement, value: string): HTMLTextAreaElement {
  const task = itemEl.createEl("textarea", {
    cls: "attest-research-card__editor-task",
    attr: { maxlength: String(MAX_RESEARCH_TEXT_CHARS) },
  });
  task.value = value;
  return task;
}

function additions(fields: readonly AddedField[]): PlanBranchAddition[] {
  return fields
    .map((field) => ({ title: field.title.value, task: field.task.value }))
    .filter((addition) => addition.title.trim() !== "" || addition.task.trim() !== "");
}
