import { validatePublicWebUrl } from "../../src/application/sources/WebUrlPolicy";

describe("validatePublicWebUrl", () => {
  it.each([
    "http://localhost/page",
    "http://localhost./page",
    "http://sub.localhost/page",
    "http://127.0.0.1/page",
    "http://2130706433/page",
    "http://10.0.0.1/page",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/page",
    "http://192.168.1.1/page",
    "http://[::1]/page",
    "http://[fc00::1]/page",
    "http://[fe80::1]/page",
    "https://user:password@example.com/page",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s", (url) => {
    expect(validatePublicWebUrl(url)).toMatchObject({ ok: false });
  });

  it("accepts a public HTTPS URL and removes its fragment", () => {
    expect(validatePublicWebUrl("HTTPS://Example.COM:443/path?q=1#section")).toEqual({
      ok: true,
      url: "https://example.com/path?q=1",
    });
  });
});
