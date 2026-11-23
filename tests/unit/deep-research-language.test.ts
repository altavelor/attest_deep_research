import {
  detectResearchLanguage,
  parseClarification,
  researchLanguageOf,
  validateResearchSection,
  type ResearchState,
} from "@core/research/deepResearch";
import { pendingResearch } from "../support/deepResearch";

function stored(state: ResearchState) {
  return validateResearchSection(
    JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
  );
}

describe("deep research language", () => {
  it("detects the language of a question by script, then by Latin stop words, then English", () => {
    expect(detectResearchLanguage("Почему бывают приливы? (tides)")).toBe("ru");
    expect(detectResearchLanguage("Wie entstehen die Gezeiten?")).toBe("de");
    expect(detectResearchLanguage("Tides 2026?")).toBe("en");
  });

  it("keeps the reported language of a clarification only when it is a language tag", () => {
    const reply = (language: unknown) =>
      parseClarification(JSON.stringify({ status: "ready", assumptions: [], language }));
    expect(reply(" RU ")).toMatchObject({ language: "ru" });
    expect(reply("Russian language")).toMatchObject({ language: null });
  });

  it("stores a valid research language, rejects a malformed one and derives a missing one", () => {
    const state = { ...pendingResearch(), question: "Почему бывают приливы?" };
    const kept = stored({ ...state, language: "zh-cn" });
    expect(kept.ok && kept.value.active?.language).toBe("zh-cn");
    expect(stored({ ...state, language: "not a tag" }).ok).toBe(false);
    const old = stored(state);
    expect(old.ok && old.value.active).not.toHaveProperty("language");
    expect(researchLanguageOf(old.ok ? old.value.active! : state)).toBe("ru");
  });
});
