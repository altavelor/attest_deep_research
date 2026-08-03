const LIGHT_VARS = `
  --dr-bg:#f9f8f6;--dr-surface:#fff;--dr-surface-2:#f3f2ef;
  --dr-text:#1c1917;--dr-muted:#78716c;--dr-border:#e7e5e0;--dr-border-2:#d6d3ce;
  --dr-accent:#cc5200;--dr-accent-bg:#fff4ef;
  --dr-success:#166534;--dr-success-bg:#f0fdf4;--dr-success-border:#bbf7d0;
  --dr-warning:#92400e;--dr-warning-bg:#fffbeb;--dr-warning-border:#fde68a;
  --dr-danger:#991b1b;--dr-danger-bg:#fef2f2;--dr-danger-border:#fecaca;
  --dr-neutral-bg:#f3f4f6;--dr-neutral-text:#374151;
`;

const DARK_VARS = `
  --dr-bg:#111110;--dr-surface:#1c1b19;--dr-surface-2:#242320;
  --dr-text:#e8e4df;--dr-muted:#9c9791;--dr-border:#2e2c28;--dr-border-2:#3d3a35;
  --dr-accent:#f97316;--dr-accent-bg:#1c1007;
  --dr-success:#4ade80;--dr-success-bg:#052e16;--dr-success-border:#14532d;
  --dr-warning:#fbbf24;--dr-warning-bg:#1c1000;--dr-warning-border:#451a03;
  --dr-danger:#f87171;--dr-danger-bg:#1c0606;--dr-danger-border:#450a0a;
  --dr-neutral-bg:#1f2937;--dr-neutral-text:#d1d5db;
`;

export const CSS = `
:root, :host {${LIGHT_VARS}color-scheme:light dark;}
@media(prefers-color-scheme:dark){:root,:host{${DARK_VARS}}}

:host(.dr-theme-dark){${DARK_VARS}}
:host(.dr-theme-light){${LIGHT_VARS}}
*{box-sizing:border-box;margin:0;padding:0}
body,.dr-root{background:var(--dr-bg);color:var(--dr-text);font:14px/1.6 'Inter',system-ui,-apple-system,sans-serif}
.layout{width:min(960px,calc(100% - 32px));margin:auto;padding:24px 0 48px}
code,pre,.mono{font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;font-size:12px}
a{color:var(--dr-accent)}


.top-nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;height:48px;padding:0 16px;background:var(--dr-surface);border-bottom:1px solid var(--dr-border)}
.nav-brand{font-weight:700;color:var(--dr-accent)}
.nav-label{color:var(--dr-muted);font-size:13px}
.nav-anchors{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.nav-anchor{font-size:12px;text-decoration:none;padding:2px 8px;border-radius:99px;background:var(--dr-surface-2);color:var(--dr-muted)}
.nav-anchor:hover{color:var(--dr-text)}


.page-header{margin-bottom:16px;padding:24px;border:1px solid var(--dr-border);border-radius:12px;background:var(--dr-surface)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dr-muted);margin-bottom:8px}
.question-text{font-size:17px;font-weight:500;margin-bottom:12px}
.header-badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.meta{font-size:13px;color:var(--dr-muted);margin-top:4px}


.card{margin-bottom:16px;border:1px solid var(--dr-border);border-radius:12px;background:var(--dr-surface);overflow:hidden}
.card-eyebrow{padding:8px 20px;background:var(--dr-surface-2);font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dr-muted);border-bottom:1px solid var(--dr-border)}
.card-body{padding:20px 24px}
.sub-heading{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dr-muted);margin-top:20px;margin-bottom:8px}
.sub-heading:first-child{margin-top:0}


.def-list{display:grid;grid-template-columns:minmax(160px,220px) 1fr;gap:0}
.def-list div{display:contents}
.def-list dt,.def-list dd{padding:7px 0;border-bottom:1px solid var(--dr-border);font-size:13px}
.def-list dt{color:var(--dr-muted)}
.def-list dd{padding-left:12px;overflow-wrap:anywhere}


.badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:500;border:1px solid transparent;line-height:1.6}
.badge-success{background:var(--dr-success-bg);color:var(--dr-success);border-color:var(--dr-success-border)}
.badge-warning{background:var(--dr-warning-bg);color:var(--dr-warning);border-color:var(--dr-warning-border)}
.badge-danger{background:var(--dr-danger-bg);color:var(--dr-danger);border-color:var(--dr-danger-border)}
.badge-accent{background:var(--dr-accent-bg);color:var(--dr-accent)}
.badge-neutral{background:var(--dr-neutral-bg);color:var(--dr-neutral-text);border-color:var(--dr-border)}


.tag,.tag-success{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;font-size:12px;background:var(--dr-surface-2);color:var(--dr-muted);margin-right:3px}
.tag-success{background:var(--dr-success-bg);color:var(--dr-success)}


.callout{padding:12px 16px;border-radius:8px;border-left:4px solid;margin:12px 0;font-size:13px}
.callout-warning{background:var(--dr-warning-bg);border-color:var(--dr-warning);color:var(--dr-warning)}
.callout-danger{background:var(--dr-danger-bg);border-color:var(--dr-danger);color:var(--dr-danger)}
.callout-neutral{background:var(--dr-neutral-bg);border-color:var(--dr-border-2)}
.callout ul{padding-left:20px;margin-top:4px}


.data-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.data-table th{background:var(--dr-surface-2);padding:6px 10px;text-align:left;font-size:12px;font-weight:600;color:var(--dr-muted);border-bottom:1px solid var(--dr-border)}
.data-table td{padding:6px 10px;border-bottom:1px solid var(--dr-border);vertical-align:top}
.data-table tr:last-child td{border-bottom:none}


.util-bar{height:8px;border-radius:4px;background:var(--dr-surface-2);overflow:hidden;margin:8px 0 4px}
.util-fill{height:100%;border-radius:4px;transition:width .3s}
.util-fill-success{background:var(--dr-success)}
.util-fill-warning{background:var(--dr-warning)}
.util-fill-danger{background:var(--dr-danger)}
.budget-label{font-size:13px;color:var(--dr-muted);margin-bottom:8px}


.score-above{color:var(--dr-success);font-weight:600}
.score-below{color:var(--dr-danger);font-weight:600}
.score-stats{font-size:13px;color:var(--dr-muted);margin:4px 0 8px}
.muted{color:var(--dr-muted);font-size:12px}


.findings-summary{font-size:15px;margin-bottom:16px}
.finding{padding:12px 16px;border-radius:8px;border:1px solid var(--dr-border);margin-bottom:10px;position:relative;border-left-width:4px}
.finding-error{border-left-color:var(--dr-danger);background:var(--dr-danger-bg)}
.finding-warning{border-left-color:var(--dr-warning);background:var(--dr-warning-bg)}
.finding-info{border-left-color:var(--dr-border-2);background:var(--dr-surface-2)}
.finding-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.finding-detail{font-size:13px;color:var(--dr-muted);margin:4px 0}
.finding-evidence{font-size:12px;margin-top:6px}
.finding-evidence code{margin-right:6px;background:var(--dr-surface-2);padding:1px 5px;border-radius:4px}


.metric-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:16px}
.metric{padding:10px 12px;border:1px solid var(--dr-border);border-radius:8px;background:var(--dr-surface-2)}
.metric span{display:block;font-size:11px;color:var(--dr-muted);text-transform:uppercase;letter-spacing:.04em}
.metric strong{font-size:15px}


.trace-round{border:1px solid var(--dr-border);border-radius:8px;margin-bottom:8px;background:var(--dr-surface)}
.trace-round-summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;font-size:13px;color:var(--dr-text)}
.trace-round[open]>.trace-round-summary{border-bottom:1px solid var(--dr-border)}
.trace-round-body{padding:10px 14px 12px}
.trace-prompt-delta{margin-bottom:8px;padding:6px 10px;border-radius:6px;background:var(--dr-surface-2)}
.trace-call{padding:5px 0;border-bottom:1px solid var(--dr-border);font-size:12px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.trace-call:last-child{border-bottom:none}
.trace-call-status{font-weight:700}
.trace-call.is-ok .trace-call-status{color:var(--dr-success)}
.trace-call.is-failed .trace-call-status{color:var(--dr-danger)}
.trace-call.is-empty .trace-call-status{color:var(--dr-warning)}
.trace-call.is-failed{background:var(--dr-danger-bg)}
.trace-call.is-empty code{color:var(--dr-warning)}
.trace-call-args{color:var(--dr-muted);font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere}
.trace-call-hint{flex-basis:100%;color:var(--dr-warning);font-size:11px;padding-left:20px}
.trace-text-output{margin-top:8px;font-size:13px;color:var(--dr-success)}


.card-collapsed>summary.card-eyebrow{cursor:pointer;border-bottom:none;list-style:revert}
.card-collapsed[open]>summary.card-eyebrow{border-bottom:1px solid var(--dr-border)}


.round-call{padding:6px 0;border-bottom:1px solid var(--dr-border);font-size:12px}
.round-call:last-child{border-bottom:none}
.args-pre{background:var(--dr-surface-2);padding:4px 8px;border-radius:4px;overflow-x:auto;margin-top:4px;font-size:11px;white-space:pre-wrap}
details>summary{cursor:pointer;font-size:12px;color:var(--dr-muted)}
.repeat-badge{font-size:11px;background:var(--dr-surface-2);padding:1px 6px;border-radius:99px;color:var(--dr-muted)}


.warnings-list{padding-left:20px;color:var(--dr-warning)}
.warnings-list li{margin-bottom:4px;font-size:13px}

@media print{
  .top-nav{display:none}
  body{background:#fff;color:#000}
  .card{break-inside:avoid}
  details{display:block}
  details>summary{display:none}
}
`;
