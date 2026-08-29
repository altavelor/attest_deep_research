# Recognised providers

Attest recognises a provider by the base URL of the Server profile and reads its model listing in
that provider's own format, so chat and embedding models are told apart automatically. Any other
OpenAI-compatible endpoint keeps working through the generic listing, where a model is treated as
an embedding model when its ID says so. A chat model whose ID contains `embed` is therefore offered
for the embedding role instead of the chat role; its name can still be typed into the model field
by hand.

| Provider                                                 | Base URL                                | API format          | How embedding models are detected                                    |
| -------------------------------------------------------- | --------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| OpenRouter                                               | `https://openrouter.ai/api/v1`          | `openai-compatible` | `architecture.output_modalities`, plus a separate embeddings listing |
| DeepInfra                                                | `https://api.deepinfra.com/v1/openai`   | `openai-compatible` | `metadata.tags`                                                      |
| Together AI                                              | `https://api.together.xyz/v1`           | `openai-compatible` | model `type`                                                         |
| Mistral                                                  | `https://api.mistral.ai/v1`             | `openai-compatible` | `capabilities.completion_chat`                                       |
| OpenAI                                                   | `https://api.openai.com/v1`             | `openai-compatible` | model ID                                                             |
| Groq                                                     | `https://api.groq.com/openai/v1`        | `openai-compatible` | model ID                                                             |
| Fireworks AI                                             | `https://api.fireworks.ai/inference/v1` | `openai-compatible` | model ID                                                             |
| DeepSeek                                                 | `https://api.deepseek.com`              | `openai-compatible` | model ID                                                             |
| Cerebras                                                 | `https://api.cerebras.ai/v1`            | `openai-compatible` | model ID                                                             |
| Nebius AI Studio                                         | `https://api.studio.nebius.com/v1`      | `openai-compatible` | model ID                                                             |
| Novita AI                                                | `https://api.novita.ai/v3/openai`       | `openai-compatible` | model ID                                                             |
| LM Studio, vLLM, llama.cpp and other self-hosted servers | local URL                               | `openai-compatible` | model ID                                                             |
| Ollama                                                   | local URL                               | `ollama`            | every model is offered for both roles                                |
| Anthropic                                                | `https://api.anthropic.com/v1`          | `anthropic`         | chat only; embeddings are not supported                              |

The embedding profile is still verified with a real embedding request when it is saved, so a model
that the provider lists but cannot embed is suspended with an explanation.
