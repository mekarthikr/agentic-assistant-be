import type { LLMProvider, LLMRequest, LLMResponse } from "@app/types";

const MOCK_STREAM_TOKENS = ["Hello ", "I ", "am ", "Mock ", "AI"];
const TOKEN_DELAY_MS = 25;

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted();

    const handleAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("The operation was aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    signal?.addEventListener("abort", handleAbort, { once: true });
  });

export class MockProvider implements LLMProvider {
  public readonly modelInfo = {
    model: "mock",
    contextWindow: 4_096,
  };

  public async generate({ signal }: LLMRequest): Promise<LLMResponse> {
    signal?.throwIfAborted();
    const text = "This is a mock AI response.";
    return {
      text,
      toolCalls: [],
      assistantMessage: { role: "assistant", content: text },
      usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
    };
  }

  public async *stream({ signal }: LLMRequest): AsyncGenerator<string> {
    for (const token of MOCK_STREAM_TOKENS) {
      await delay(TOKEN_DELAY_MS, signal);
      signal?.throwIfAborted();
      yield token;
    }
  }
}
