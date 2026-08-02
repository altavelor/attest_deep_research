export function h(value: unknown): string {
  const str = String(value ?? "");
  return str.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function attr(value: unknown): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

export type BadgeVariant = "success" | "warning" | "danger" | "accent" | "neutral";

export function badge(text: string, variant: BadgeVariant = "neutral"): string {
  return `<span class="badge badge-${attr(variant)}">${h(text)}</span>`;
}

export function tag(text: string): string {
  return `<span class="tag">${h(text)}</span>`;
}

export function yesNo(value: boolean): string {
  return value ? badge("yes", "success") : badge("no", "neutral");
}

export function dl(rows: Array<[string, string]>): string {
  return `<dl class="def-list">${rows.map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

export function card(id: string, eyebrow: string, body: string): string {
  return `<section class="card" id="${attr(id)}"><header class="card-eyebrow">${h(eyebrow)}</header><div class="card-body">${body}</div></section>`;
}

/** Card collapsed by default: reference material, not the story. */
export function collapsedCard(id: string, eyebrow: string, body: string): string {
  return `<details class="card card-collapsed" id="${attr(id)}"><summary class="card-eyebrow">${h(eyebrow)}</summary><div class="card-body">${body}</div></details>`;
}

export function sub(title: string): string {
  return `<h4 class="sub-heading">${h(title)}</h4>`;
}

export function callout(variant: BadgeVariant, html: string): string {
  return `<div class="callout callout-${attr(variant)}">${html}</div>`;
}

export function utilizationBar(pct: number | null): string {
  if (pct === null) return "";
  const clamped = Math.min(100, Math.max(0, pct));
  const colour = pct > 90 ? "danger" : pct > 75 ? "warning" : "success";
  return `<div class="util-bar" role="meter" aria-valuenow="${h(clamped)}" aria-valuemax="100"><div class="util-fill util-fill-${attr(colour)}" style="width:${h(clamped)}%"></div></div>`;
}
