// @vitest-environment happy-dom

import {
  browserDownloadEnvironment,
  downloadDiagnosticHtml,
} from "@apps/obsidian/ui/diagnostics/download";
import { installObsidianDomHelpers } from "../helpers/domHarness";

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
      "attest-diagnostic-run-unsafe.html",
    );
    expect(calls).toEqual([
      "create",
      "trigger:blob:report:attest-diagnostic-run-unsafe.html",
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

  it("creates the download anchor in the modal's popout document", () => {
    installObsidianDomHelpers();
    const popoutDocument = document.implementation.createHTMLDocument("Popout");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    browserDownloadEnvironment(popoutDocument).trigger("blob:report", "report.html");

    expect(click).toHaveBeenCalledTimes(1);
    expect(popoutDocument.querySelector("a")).toBeNull();
  });
});
