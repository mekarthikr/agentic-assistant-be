import type { MessageRole } from "./ai.types.js";

export interface ChatHistoryMessage {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatHistoryMessage[];
  signal: AbortSignal;
}

/**
 * Produces a complete or streaming assistant response for a chat request.
 *
 * @param request - Validated chat input and its cancellation signal.
 * @returns A complete response or asynchronous stream of response chunks.
 */
export type ChatHandler = (
  request: ChatRequest,
) => Promise<string> | AsyncIterable<string>;
