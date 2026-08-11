import type { FlexibleSchema, ToolModelMessage, ToolSet } from "ai";

import type { LLMToolCall } from "@app/types";
import { logError } from "@app/utils/error-logger";

// The documented mock Applications API currently returns roughly 10,000
// characters for an unfiltered list. Keep a complete agent list available to
// the model while retaining a bound for unexpectedly large production data.
const MAX_TOOL_RESULT_CHARACTERS = 12_000;

export interface ToolExecutionContext {
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  readonly userType?: "agent" | "client";
  readonly clientName?: string;
}

/**
 * An application capability. Implementations are supplied by the composition
 * root, never by an LLM provider.
 */
export interface ApplicationTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: FlexibleSchema<unknown>;
  execute(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> | unknown;
}

export interface ToolExecutionResults {
  readonly message: ToolModelMessage;
  /** Raw successful results, retained server-side for deterministic presentation. */
  readonly values: readonly unknown[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ApplicationTool>();

  public constructor(tools: readonly ApplicationTool[] = []) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`A tool named "${tool.name}" is already registered.`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  /** Returns selected AI SDK schema metadata; no executable code crosses this boundary. */
  public toToolSet(names?: readonly string[]): ToolSet {
    const selectedNames = names === undefined ? undefined : new Set(names);

    return Object.fromEntries(
      [...this.tools.values()]
        .filter(({ name }) => selectedNames?.has(name) ?? true)
        .map(({ name, description, inputSchema }) => [
          name,
          { description, inputSchema },
        ]),
    ) as ToolSet;
  }

  public async executeAll(
    calls: readonly LLMToolCall[],
    context: Omit<ToolExecutionContext, "toolCallId"> = {},
  ): Promise<ToolModelMessage> {
    return (await this.executeAllWithResults(calls, context)).message;
  }

  public async executeAllWithResults(
    calls: readonly LLMToolCall[],
    context: Omit<ToolExecutionContext, "toolCallId"> = {},
  ): Promise<ToolExecutionResults> {
    const values: unknown[] = [];
    const content = await Promise.all(
      calls.map(async (call) => {
        context.signal?.throwIfAborted();
        const tool = this.tools.get(call.toolName);

        if (!tool) {
          return {
            type: "tool-result" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: {
              type: "error-text" as const,
              value: `Tool "${call.toolName}" is not available.`,
            },
          };
        }

        try {
          const value = await tool.execute(call.input, {
            toolCallId: call.toolCallId,
            ...context,
          });
          context.signal?.throwIfAborted();
          values.push(value);
          return {
            type: "tool-result" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "text" as const, value: this.serialize(value) },
          };
        } catch (error) {
          context.signal?.throwIfAborted();
          logError("Enterprise tool execution failed", error, {
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            input: call.input,
          });
          return {
            type: "tool-result" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: {
              type: "error-text" as const,
              value:
                error instanceof Error
                  ? error.message
                  : "Tool execution failed.",
            },
          };
        }
      }),
    );

    return { message: { role: "tool", content }, values };
  }

  private serialize(value: unknown): string {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    if (serialized === undefined) return "null";
    if (serialized.length <= MAX_TOOL_RESULT_CHARACTERS) return serialized;

    return `${serialized.slice(0, MAX_TOOL_RESULT_CHARACTERS)}
...[tool result truncated to reduce token usage]`;
  }
}
