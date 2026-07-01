import { downloadDiagnosticHtml } from "@apps/obsidian/ui/diagnosticDownload";

describe("diagnostic HTML download", () => {
  it("uses a sanitized filename and always revokes the object URL", () => {
    const calls: string[] = [];
    const environment = {
      createObjectUrl: (blob: Blob) => {
        expect(blob.type).toBe("text/html;charset=utf-8");
        calls.push("create");
        return "blob:report";
      },
      trigger: (url: string, filename: string) => {
        calls.push(`trigger:${url}:${filename}`);
      },
      revokeObjectUrl: (url: string) => calls.push(`revoke:${url}`),
    };

    expect(downloadDiagnosticHtml("<html></html>", "run / unsafe", environment)).toBe(
      "ixplorer-diagnostic-run-unsafe.html",
    );
    expect(calls).toEqual([
      "create",
      "trigger:blob:report:ixplorer-diagnostic-run-unsafe.html",
      "revoke:blob:report",
    ]);
  });

  it("revokes the object URL when triggering the download fails", () => {
    const revoke = vi.fn();
    expect(() =>
      downloadDiagnosticHtml("x", "run", {
        createObjectUrl: () => "blob:failed",
        trigger: () => {
          throw new Error("blocked");
        },
        revokeObjectUrl: revoke,
      }),
    ).toThrow("blocked");
    expect(revoke).toHaveBeenCalledWith("blob:failed");
  });
});
