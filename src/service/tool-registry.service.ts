import type { FlexibleSchema, ToolModelMessage, ToolSet } from "ai";

import type { LLMToolCall } from "../types/index.js";

export interface ToolExecutionContext {
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
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

  /** Returns only the AI SDK schema metadata; no executable code crosses this boundary. */
  public toToolSet(names?: readonly string[]): ToolSet {
    const selectedNames = names ? new Set(names) : null;
    return Object.fromEntries(
      [...this.tools.values()]
        .filter(({ name }) => !selectedNames || selectedNames.has(name))
        .map(({ name, description, inputSchema }) => [
          name,
          { description, inputSchema },
        ]),
    ) as ToolSet;
  }

  public async executeAll(
    calls: readonly LLMToolCall[],
    signal?: AbortSignal,
  ): Promise<ToolModelMessage> {
    const content = await Promise.all(
      calls.map(async (call) => {
        signal?.throwIfAborted();
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
            signal,
          });
          signal?.throwIfAborted();
          return {
            type: "tool-result" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "text" as const, value: this.serialize(value) },
          };
        } catch (error) {
          signal?.throwIfAborted();
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

    return { role: "tool", content };
  }

  private serialize(value: unknown): string {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
  }
}
