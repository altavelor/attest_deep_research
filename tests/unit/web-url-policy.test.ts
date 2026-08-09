import { describe, expect, it } from "vitest";

import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";

describe("validatePublicWebUrl", () => {
  it.each([
    ["notaurl", "invalid-url"],
    ["file:///private/secret", "unsupported-protocol"],
    ["https://user:pass@example.com", "credentials-not-allowed"],
    ["https://localhost/resource", "local-hostname"],
    ["http://localhost./page", "local-hostname"],
    ["https://service.localhost/resource", "local-hostname"],
    ["http://127.0.0.1/page", "non-public-address"],
    ["http://2130706433/page", "non-public-address"],
    ["http://10.0.0.1/resource", "non-public-address"],
    ["http://100.64.0.1/resource", "non-public-address"],
    ["http://169.254.1.1/resource", "non-public-address"],
    ["http://172.16.1.1/resource", "non-public-address"],
    ["http://192.168.1.1/page", "non-public-address"],
    ["http://192.0.2.1/resource", "non-public-address"],
    ["http://198.51.100.1/resource", "non-public-address"],
    ["http://203.0.113.1/resource", "non-public-address"],
    ["http://224.0.0.1/resource", "non-public-address"],
    ["https://[::1]/resource", "non-public-address"],
    ["https://[fd00::1]/resource", "non-public-address"],
    ["https://[fc00::1]/page", "non-public-address"],
    ["https://[fe80::1]/page", "non-public-address"],
    ["https://[2001:db8::1]/resource", "non-public-address"],
    ["https://[::ffff:127.0.0.1]/resource", "non-public-address"],
  ])("rejects %s", (url, reason) => {
    expect(validatePublicWebUrl(url)).toEqual({ ok: false, reason });
  });

  it("normalizes safe URLs before they enter the web tool pipeline", () => {
    expect(validatePublicWebUrl("HTTPS://Example.COM.:443/path#section")).toEqual({
      ok: true,
      url: "https://example.com/path",
    });
    expect(validatePublicWebUrl("http://93.184.216.34:80/article")).toEqual({
      ok: true,
      url: "http://93.184.216.34/article",
    });
    expect(validatePublicWebUrl("https://[2606:4700::1111]/article").ok).toBe(true);
  });
});
