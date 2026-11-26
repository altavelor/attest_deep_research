import type { Translate } from "@adapters/i18n";
import { MAX_PLAN_LIST_ITEMS, MAX_RESEARCH_TEXT_CHARS } from "@core/research/deepResearch";

/**
 * Renders the editable known omissions of a plan: each entry can be changed or removed and new
 * ones added up to the plan list limit. The returned function reads the non-blank entries.
 */
export function renderOmissionsEditor(
  parentEl: HTMLElement,
  omissions: readonly string[],
  t: Translate,
): () => string[] {
  parentEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.card.omissions"),
  });
  const listEl = parentEl.createEl("ul", { cls: "attest-research-card__omissions" });
  const fields: HTMLInputElement[] = [];
  const addEl = parentEl.createDiv({
    cls: "attest-research-card__actions attest-research-card__add",
  });
  const addButton = addEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t("chat.deepResearch.action.addOmission"),
  });
  const refresh = (): void => {
    addButton.disabled = fields.length >= MAX_PLAN_LIST_ITEMS;
  };
  const add = (value: string): HTMLInputElement => {
    const itemEl = listEl.createEl("li", { cls: "attest-research-card__editor-row" });
    const field = itemEl.createEl("input", {
      cls: "attest-research-card__editor-title",
      attr: {
        type: "text",
        maxlength: String(MAX_RESEARCH_TEXT_CHARS),
        placeholder: t("chat.deepResearch.editor.omissionPlaceholder"),
      },
    });
    field.value = value;
    fields.push(field);
    const remove = itemEl.createEl("button", {
      cls: "attest-research-card__action",
      text: t("chat.deepResearch.action.removeBranch"),
    });
    remove.addEventListener("click", () => {
      fields.splice(fields.indexOf(field), 1);
      itemEl.remove();
      refresh();
    });
    refresh();
    return field;
  };
  for (const omission of omissions) add(omission);
  addButton.addEventListener("click", () => {
    if (!addButton.disabled) add("").focus();
  });
  return () => fields.map((field) => field.value.trim()).filter((value) => value !== "");
}
