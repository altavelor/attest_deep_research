import { describe, expect, it } from "vitest";

import {
  isVaultContainedFolder,
  ONBOARDING_SCOPES,
  nextStep,
  previousStep,
  scopeNeedsIndex,
  searchModeForScope,
  stepPosition,
  stepsForScope,
} from "@core/onboarding";

describe("onboarding flow", () => {
  it("cuts the route to two steps for the web-only scope", () => {
    expect(stepsForScope("webOnly")).toEqual(["chat", "scope"]);
    expect(stepsForScope("notesOnly")).toEqual(["chat", "scope", "embedding", "folders"]);
    expect(stepsForScope("notesAndWeb")).toEqual(["chat", "scope", "embedding", "folders"]);
  });

  it("assumes the longest route before a scope is picked so the progress never grows", () => {
    expect(stepsForScope(undefined)).toHaveLength(4);
    for (const scope of ONBOARDING_SCOPES) {
      expect(stepsForScope(scope).length).toBeLessThanOrEqual(stepsForScope(undefined).length);
    }
  });

  it("ends the wizard after the scope step on the web-only route", () => {
    expect(nextStep("webOnly", "scope")).toBeUndefined();
    expect(nextStep("notesOnly", "scope")).toBe("embedding");
    expect(nextStep("notesAndWeb", "embedding")).toBe("folders");
    expect(nextStep("notesAndWeb", "folders")).toBeUndefined();
  });

  it("offers no step before the first one", () => {
    expect(previousStep(undefined, "chat")).toBeUndefined();
    expect(previousStep("notesOnly", "folders")).toBe("embedding");
    expect(previousStep("webOnly", "scope")).toBe("chat");
  });

  it("reports a one-based position and zero for a step the route omits", () => {
    expect(stepPosition("webOnly", "chat")).toBe(1);
    expect(stepPosition("webOnly", "scope")).toBe(2);
    expect(stepPosition("webOnly", "embedding")).toBe(0);
    expect(stepPosition("notesOnly", "folders")).toBe(4);
  });

  it("maps each scope onto the matching new-chat search mode", () => {
    expect(searchModeForScope("webOnly")).toBe("webOnly");
    expect(searchModeForScope("notesOnly")).toBe("indexOnly");
    expect(searchModeForScope("notesAndWeb")).toBe("indexAndWeb");
  });

  it("needs an index for every scope that reads the vault", () => {
    expect(scopeNeedsIndex("webOnly")).toBe(false);
    expect(scopeNeedsIndex("notesOnly")).toBe(true);
    expect(scopeNeedsIndex("notesAndWeb")).toBe(true);
  });

  it("refuses an index location that leaves the vault", () => {
    expect(isVaultContainedFolder(".attest/index")).toBe(true);
    expect(isVaultContainedFolder("Data/attest-index")).toBe(true);
    expect(isVaultContainedFolder("  ")).toBe(true);
    expect(isVaultContainedFolder("../outside")).toBe(false);
    expect(isVaultContainedFolder("notes/../../escape")).toBe(false);
    expect(isVaultContainedFolder("/absolute")).toBe(false);
    expect(isVaultContainedFolder("..\\windows")).toBe(false);
  });
});
