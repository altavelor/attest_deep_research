import { describe, expect, it } from "vitest";

import { modelDisplayName } from "@core/agent";

describe("modelDisplayName", () => {
  it("drops the vendor prefix the server profile already names", () => {
    expect(modelDisplayName("meta-llama/llama-3.1-70b-instruct")).toBe("Llama 3.1 70B Instruct");
    expect(modelDisplayName("anthropic/claude-opus-4.8")).toBe("Claude Opus 4.8");
  });

  it("uppercases size and keeps version tokens", () => {
    expect(modelDisplayName("mistralai/mixtral-8x7b-instruct")).toBe("Mixtral 8x7B Instruct");
    expect(modelDisplayName("deepseek/deepseek-chat-v3-0324")).toBe("DeepSeek Chat v3 0324");
  });

  it("keeps well-known spellings instead of naive capitalisation", () => {
    expect(modelDisplayName("openai/gpt-4.1-mini")).toBe("GPT 4.1 Mini");
    expect(modelDisplayName("google/gemma-2-27b-it")).toBe("Gemma 2 27B It");
  });

  it("renders a trailing tag as a qualifier or as a size", () => {
    expect(modelDisplayName("anthropic/claude-opus-4.8:batch")).toBe("Claude Opus 4.8 (batch)");
    expect(modelDisplayName("qwen/qwen-2.5-72b:free")).toBe("Qwen 2.5 72B (free)");
    expect(modelDisplayName("llama3.1:8b")).toBe("Llama3.1 8B");
  });

  it("handles ids with no vendor prefix", () => {
    expect(modelDisplayName("nomic-embed-text")).toBe("Nomic Embed Text");
    expect(modelDisplayName("text-embedding-3-small")).toBe("Text Embedding 3 Small");
  });

  it("survives ids that carry no words", () => {
    expect(modelDisplayName("")).toBe("");
    expect(modelDisplayName("   ")).toBe("");
    expect(modelDisplayName("vendor/")).toBe("");
    expect(modelDisplayName("///")).toBe("");
    expect(modelDisplayName("---")).toBe("");
  });
});
