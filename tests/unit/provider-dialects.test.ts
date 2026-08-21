import { capabilityFromKinds, resolveProviderDialect } from "@adapters/settings";

describe("provider dialect resolution", () => {
  it("selects a dialect from the configured base URL host", () => {
    expect(resolveProviderDialect("https://openrouter.ai/api/v1").id).toBe("openrouter");
    expect(resolveProviderDialect("https://api.deepinfra.com/v1/openai").id).toBe("deepinfra");
    expect(resolveProviderDialect("https://api.together.xyz/v1").id).toBe("together");
    expect(resolveProviderDialect("https://api.mistral.ai/v1").id).toBe("mistral");
    expect(resolveProviderDialect("https://api.groq.com/openai/v1").id).toBe("groq");
  });

  it("falls back to the plain OpenAI-compatible dialect for unknown and invalid URLs", () => {
    expect(resolveProviderDialect("http://localhost:1234/v1").id).toBe("openai-compatible");
    expect(resolveProviderDialect("not a url").id).toBe("openai-compatible");
    expect(resolveProviderDialect("").id).toBe("openai-compatible");
  });

  it("does not match a host that merely contains a known provider name", () => {
    expect(resolveProviderDialect("https://openrouter.ai.example.com/v1").id).toBe(
      "openai-compatible",
    );
    expect(resolveProviderDialect("https://api.openrouter.ai/v1").id).toBe("openrouter");
  });
});

describe("provider dialect model parsing", () => {
  it("reads OpenRouter embedding models from architecture modalities", () => {
    const dialect = resolveProviderDialect("https://openrouter.ai/api/v1");
    const entries = dialect.extractEntries({
      data: [
        {
          id: "voyageai/voyage-4",
          architecture: { modality: "text->embeddings", output_modalities: ["embeddings"] },
        },
        {
          id: "openai/gpt-5",
          architecture: { modality: "text->text", output_modalities: ["text"] },
        },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(dialect.detectKinds(entries![0]!)).toEqual({ chat: false, embeddings: true });
    expect(dialect.detectKinds(entries![1]!)).toEqual({ chat: true, embeddings: false });
  });

  it("requests the OpenRouter embedding listing in addition to the default one", () => {
    expect(resolveProviderDialect("https://openrouter.ai/api/v1").modelListPaths).toEqual([
      "/models",
      "/models?output_modalities=embeddings",
    ]);
  });

  it("reads DeepInfra model kinds from metadata tags", () => {
    const dialect = resolveProviderDialect("https://api.deepinfra.com/v1/openai");

    expect(
      dialect.detectKinds({ id: "Qwen/Qwen3-Embedding-0.6B", metadata: { tags: ["embed"] } }),
    ).toEqual({ chat: false, embeddings: true });
    expect(
      dialect.detectKinds({ id: "Qwen/Qwen3-32B", metadata: { tags: ["text-generation"] } }),
    ).toEqual({ chat: true, embeddings: false });
  });

  it("reads Together model kinds from the explicit type field and a bare array listing", () => {
    const dialect = resolveProviderDialect("https://api.together.xyz/v1");
    const entries = dialect.extractEntries([
      { id: "BAAI/bge-large-en-v1.5", type: "embedding" },
      { id: "meta-llama/Llama-4", type: "chat" },
      { id: "mixedbread-ai/Mxbai-Rerank", type: "rerank" },
    ]);

    expect(entries).toHaveLength(3);
    expect(dialect.detectKinds(entries![0]!)).toEqual({ chat: false, embeddings: true });
    expect(dialect.detectKinds(entries![1]!)).toEqual({ chat: true, embeddings: false });
    expect(dialect.detectKinds(entries![2]!)).toEqual({ chat: false, embeddings: false });
  });

  it("falls back to the model name for a Together type it does not know", () => {
    const dialect = resolveProviderDialect("https://api.together.xyz/v1");

    expect(dialect.detectKinds({ id: "some/new-chat-model", type: "conversation" })).toEqual({
      chat: true,
      embeddings: false,
    });
    expect(dialect.detectKinds({ id: "some/new-embed-model", type: "conversation" })).toEqual({
      chat: false,
      embeddings: true,
    });
  });

  it("reads Mistral model kinds from the capabilities object", () => {
    const dialect = resolveProviderDialect("https://api.mistral.ai/v1");

    expect(
      dialect.detectKinds({ id: "mistral-embed", capabilities: { completion_chat: false } }),
    ).toEqual({ chat: false, embeddings: true });
    expect(
      dialect.detectKinds({ id: "mistral-large-latest", capabilities: { completion_chat: true } }),
    ).toEqual({ chat: true, embeddings: false });
  });

  it("falls back to the model name when a provider ships no kind metadata", () => {
    const dialect = resolveProviderDialect("http://localhost:1234/v1");

    expect(dialect.detectKinds({ id: "text-embedding-nomic-v1.5" })).toEqual({
      chat: false,
      embeddings: true,
    });
    expect(dialect.detectKinds({ id: "qwen3" })).toEqual({ chat: true, embeddings: false });
  });

  it("survives malformed listings and entries without throwing", () => {
    const dialect = resolveProviderDialect("https://openrouter.ai/api/v1");

    expect(dialect.extractEntries({ data: "nope" })).toBeNull();
    expect(dialect.extractEntries(null)).toBeNull();
    expect(dialect.extractEntries("nope")).toBeNull();
    expect(dialect.extractEntries({ data: [1, "two", null, { id: "ok" }] })).toEqual([
      { id: "ok" },
    ]);
    expect(dialect.detectKinds({ id: "x", architecture: "broken" })).toEqual({
      chat: true,
      embeddings: false,
    });
    expect(
      resolveProviderDialect("https://api.together.xyz/v1").detectKinds({ id: "x", type: 7 }),
    ).toEqual({ chat: true, embeddings: false });
    expect(
      resolveProviderDialect("https://api.deepinfra.com/v1/openai").detectKinds({
        id: "x",
        metadata: { tags: "embed" },
      }),
    ).toEqual({ chat: true, embeddings: false });
  });

  it("derives model capabilities from detected kinds", () => {
    expect(capabilityFromKinds({ chat: false, embeddings: true })).toEqual({
      chat: false,
      embeddings: true,
      temperature: false,
      maxTokens: false,
      detectionSource: "format-default",
    });
  });
});
