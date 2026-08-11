export interface DiagnosticDownloadEnvironment {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  trigger(url: string, filename: string): void;
}

export function downloadDiagnosticHtml(
  html: string,
  identity: string | undefined,
  environment: DiagnosticDownloadEnvironment = browserDownloadEnvironment(),
): string {
  const suffix = sanitizeFilenamePart(identity ?? new Date().toISOString());
  const filename = `attest-diagnostic-${suffix}.html`;
  const url = environment.createObjectUrl(new Blob([html], { type: "text/html;charset=utf-8" }));
  try {
    environment.trigger(url, filename);
  } finally {
    environment.revokeObjectUrl(url);
  }
  return filename;
}

function browserDownloadEnvironment(): DiagnosticDownloadEnvironment {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    trigger: (url, filename) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },
  };
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (sanitized || "report").slice(0, 80);
}
