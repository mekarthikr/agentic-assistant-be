import type { FlexibleSchema, ToolModelMessage, ToolSet } from "ai";

import type { LLMToolCall } from "@app/types";
import { flowTracer } from "@app/observability";

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

  /**
   * Registers application tools and rejects ambiguous duplicate names.
   *
   * @param tools - Executable application capabilities available to the model.
   */
  public constructor(tools: readonly ApplicationTool[] = []) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`A tool named "${tool.name}" is already registered.`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Converts registered tools to provider-safe AI SDK schemas.
   *
   * @param names - Optional allowlist of tool names selected by retrieval.
   * @returns Declarative tool metadata without executable implementations.
   */
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

  /**
   * Executes tool calls concurrently and converts results to one model message.
   *
   * Individual tool errors are returned to the model so it can recover, while
   * cancellation is always propagated to the caller.
   *
   * @param calls - Tool requests produced by the model.
   * @param signal - Optional cancellation signal shared by every tool.
   */
  public async executeAll(
    calls: readonly LLMToolCall[],
    signal?: AbortSignal,
  ): Promise<ToolModelMessage> {
    const content = await Promise.all(
      calls.map(async (call) => {
        signal?.throwIfAborted();
        const tool = this.tools.get(call.toolName);

        if (!tool) {
          flowTracer.record({
            stage: "tool",
            level: "error",
            action: "tool.unavailable",
            summary: `The model requested unavailable tool "${call.toolName}".`,
            details: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
            },
          });
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
          const finishTool = flowTracer.start({
            stage: "tool",
            action: "tool.execution.started",
            summary: `Executing tool "${call.toolName}".`,
            details: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: call.input,
            },
          });
          const value = await tool.execute(call.input, {
            toolCallId: call.toolCallId,
            signal,
          });
          signal?.throwIfAborted();
          finishTool({
            level: "success",
            action: "tool.execution.completed",
            summary: `Tool "${call.toolName}" completed successfully.`,
            details: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: value,
            },
          });
          return {
            type: "tool-result" as const,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "text" as const, value: this.serialize(value) },
          };
        } catch (error) {
          signal?.throwIfAborted();
          flowTracer.record({
            stage: "tool",
            level: "error",
            action: "tool.execution.failed",
            summary: `Tool "${call.toolName}" failed.`,
            details: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              error,
            },
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

    return { role: "tool", content };
  }

  /** Converts any tool result into text accepted by the AI SDK message format. */
  private serialize(value: unknown): string {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
  }
}
