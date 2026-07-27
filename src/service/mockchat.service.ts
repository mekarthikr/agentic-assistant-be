import type { ChatHandler } from "@app/types";

/**
 * Returns a deterministic development response for a user message.
 *
 * @param message - Validated user message.
 * @returns A mock assistant response suitable for local end-to-end testing.
 */
const getMockReply = (message: string): string => {
  const normalized = message.trim().toLowerCase();

  if (/^(hi|hello|hey)[!. ]*$/.test(normalized)) {
    return "Hello! How can I help you today?";
  }

  if (normalized.includes("find") && normalized.includes("contract")) {
    return "I can help find a contract. Please provide the contract number or the policyholder's name.";
  }

  if (normalized.includes("approval")) {
    return "The mock approval lookup is ready. Please provide a case or application number.";
  }

  if (normalized.includes("income") || normalized.includes("product")) {
    return "This mock assistant can help compare product features, income options, and contract details.";
  }

  return `I received: "${message}". This response is coming from the backend mock chat service.`;
};

/** Mock handler used until the production AI integration is available. */
export const mockChatHandler: ChatHandler = async ({ message }) =>
  getMockReply(message);
