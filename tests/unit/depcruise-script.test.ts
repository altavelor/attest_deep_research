import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Transpiler {
  name: string;
  available: boolean;
}

interface DepcruiseModule {
  cruiserTypeScriptSpecifier(specifier: string, parentURL: string | undefined): string;
  untrustedCruiseReasons(input: { transpilers: Transpiler[]; totalCruised: number }): string[];
}

const specifier = pathToFileURL(resolve("scripts/depcruise.mjs")).href;
const { cruiserTypeScriptSpecifier, untrustedCruiseReasons } = (await import(
  /* @vite-ignore */ specifier
)) as DepcruiseModule;

const CRUISER = "file:///repo/node_modules/dependency-cruiser/src/extract/tsc/parse.mjs";
const TYPESCRIPT_READY: Transpiler[] = [{ name: "typescript", available: true }];

describe("depcruise script", () => {
  it("routes only dependency-cruiser's TypeScript imports to the compiler API package", () => {
    expect(cruiserTypeScriptSpecifier("typescript", CRUISER)).toBe("@typescript/typescript6");
    expect(cruiserTypeScriptSpecifier("typescript/package.json", CRUISER)).toBe(
      "@typescript/typescript6/package.json",
    );
    expect(cruiserTypeScriptSpecifier("typescript-eslint", CRUISER)).toBe("typescript-eslint");
    expect(cruiserTypeScriptSpecifier("typescript", "file:///repo/esbuild.config.mjs")).toBe(
      "typescript",
    );
  });

  it("refuses a cruise without a TypeScript compiler or without modules", () => {
    expect(
      untrustedCruiseReasons({
        transpilers: [{ name: "typescript", available: false }],
        totalCruised: 534,
      }),
    ).toEqual([
      "dependency-cruiser cannot load a TypeScript compiler API (@typescript/typescript6).",
    ]);
    expect(untrustedCruiseReasons({ transpilers: TYPESCRIPT_READY, totalCruised: 0 })).toEqual([
      "dependency-cruiser visited no modules, so no layer rule was checked.",
    ]);
  });

  it("trusts a cruise that loaded TypeScript and visited a module", () => {
    expect(untrustedCruiseReasons({ transpilers: TYPESCRIPT_READY, totalCruised: 1 })).toEqual([]);
  });
});
