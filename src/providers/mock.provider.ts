import type { LLMProvider, LLMRequest } from "@app/types";

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
  public async generate({ signal }: LLMRequest): Promise<string> {
    signal?.throwIfAborted();
    return "This is a mock AI response.";
  }

  public async *stream({ signal }: LLMRequest): AsyncGenerator<string> {
    for (const token of MOCK_STREAM_TOKENS) {
      await delay(TOKEN_DELAY_MS, signal);
      signal?.throwIfAborted();
      yield token;
    }
  }
}
