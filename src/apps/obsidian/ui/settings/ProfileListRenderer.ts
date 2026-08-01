import { createIconButton, ProfileStatus } from "./shared";

export interface ProfileListItemOptions {
  name: string;
  tags?: Array<"Agent" | "Tools" | "Instant">;
  status: ProfileStatus | null;
  canDelete: boolean;
  deleteTooltip: string;
  extraActions?: Array<{
    icon: string;
    className?: string;
    label: string;
    hidden?: boolean;
    disabled?: boolean;
    onClick(): void | Promise<void>;
  }>;
  onEdit(): void;
  onDelete(): void | Promise<void>;
}

export function renderProfileList(
  containerEl: HTMLElement,
  title: string,
  onAdd: () => void,
): HTMLElement {
  const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
  const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
  header.createEl("h3", { text: title });
  createIconButton(header, {
    icon: "plus",
    label: `Add ${title.toLowerCase()}`,
    onClick: onAdd,
  });

  const table = section.createDiv({ cls: "ixplorer-settings-profile-table" });
  const tableHeader = table.createDiv({
    cls: "ixplorer-settings-profile-table__header",
    attr: { role: "row" },
  });
  tableHeader.createSpan({ text: "Profile" });
  tableHeader.createSpan({ text: "Status" });
  tableHeader.createSpan({ text: "Actions" });
  return table.createDiv({ cls: "ixplorer-settings-profile-list" });
}

export function renderProfileListItem(
  containerEl: HTMLElement,
  options: ProfileListItemOptions,
): void {
  const row = containerEl.createDiv({ cls: "ixplorer-settings-profile-list__item" });
  row.createDiv({ cls: "ixplorer-settings-profile-list__name", text: options.name });
  const statusCell = row.createDiv({ cls: "ixplorer-settings-profile-list__status-cell" });
  if (options.status) {
    statusCell.createSpan({
      cls: `ixplorer-settings-profile-list__status ${options.status.kind}`,
      text: options.status.label,
      attr: { title: options.status.title },
    });
  }
  for (const tag of options.tags ?? []) {
    statusCell.createSpan({
      cls: `ixplorer-settings-profile-list__status ixplorer-settings-profile-list__tag--${tag.toLowerCase()}`,
      text: tag,
    });
  }
  const actions = row.createDiv({ cls: "ixplorer-settings-profile-list__actions" });
  const defaultAction = options.extraActions?.[0];
  const defaultSlot = actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" });
  if (defaultAction && !defaultAction.hidden) {
    createIconButton(defaultSlot, {
      icon: defaultAction.icon,
      className: defaultAction.className,
      label: defaultAction.label,
      disabled: defaultAction.disabled,
      onClick: () => void defaultAction.onClick(),
    });
  }
  for (const action of options.extraActions ?? []) {
    if (action === defaultAction || action.hidden) continue;
    createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
      icon: action.icon,
      className: action.className,
      label: action.label,
      disabled: action.disabled,
      onClick: () => void action.onClick(),
    });
  }
  createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
    icon: "pencil",
    label: "Edit profile",
    onClick: options.onEdit,
  });
  createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
    icon: "trash",
    label: options.deleteTooltip,
    disabled: !options.canDelete,
    onClick: () => void options.onDelete(),
  });
}
