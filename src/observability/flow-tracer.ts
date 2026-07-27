import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const MAX_HISTORY = 500;
const MAX_STRING_LENGTH = 500;
const REDACTED_KEYS =
  /(?:api[-_]?key|authorization|cookie|password|secret|token)$/i;

export type FlowStage =
  | "system"
  | "http"
  | "websocket"
  | "conversation"
  | "retrieval"
  | "model"
  | "tool"
  | "enterprise"
  | "response";

export type FlowLevel = "info" | "decision" | "success" | "error";

export interface FlowContext {
  readonly traceId: string;
  readonly transport?: "http" | "websocket" | "system";
  readonly requestId?: string;
  readonly conversationId?: string;
}

export interface FlowEvent {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly stage: FlowStage;
  readonly level: FlowLevel;
  readonly action: string;
  readonly summary: string;
  readonly durationMs?: number;
  readonly context?: FlowContext;
  readonly details?: Record<string, unknown>;
}

export interface FlowEventInput {
  readonly stage: FlowStage;
  readonly level?: FlowLevel;
  readonly action: string;
  readonly summary: string;
  readonly durationMs?: number;
  readonly context?: Partial<FlowContext>;
  readonly details?: Record<string, unknown>;
}

type FlowListener = (event: FlowEvent) => void;

/** Process-local structured execution trace used by logs and `/view-flow`. */
class FlowTracer {
  private readonly storage = new AsyncLocalStorage<FlowContext>();
  private readonly history: FlowEvent[] = [];
  private readonly listeners = new Set<FlowListener>();
  private sequence = 0;

  /** Runs work with correlation fields inherited by every nested trace event. */
  public run<T>(context: FlowContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /** Adds or replaces correlation fields for a nested operation. */
  public withContext<T>(context: Partial<FlowContext>, callback: () => T): T {
    const current = this.storage.getStore();
    return this.storage.run(
      {
        traceId: context.traceId ?? current?.traceId ?? randomUUID(),
        transport: context.transport ?? current?.transport,
        requestId: context.requestId ?? current?.requestId,
        conversationId: context.conversationId ?? current?.conversationId,
      },
      callback,
    );
  }

  /** Records, logs, stores, and broadcasts one sanitized execution event. */
  public record(input: FlowEventInput): FlowEvent {
    const current = this.storage.getStore();
    const context = this.mergeContext(current, input.context);
    const event: FlowEvent = {
      id: randomUUID(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      stage: input.stage,
      level: input.level ?? "info",
      action: input.action,
      summary: input.summary,
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: Math.round(input.durationMs * 100) / 100 }),
      ...(context ? { context } : {}),
      ...(input.details
        ? {
            details: this.sanitize(input.details) as Record<string, unknown>,
          }
        : {}),
    };

    this.history.push(event);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    console.log(
      JSON.stringify({
        type: "backend.flow",
        ...event,
      }),
    );

    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Starts a timed operation and returns its completion recorder. */
  public start(
    input: Omit<FlowEventInput, "durationMs">,
  ): (completion?: Partial<FlowEventInput>) => FlowEvent {
    const startedAt = performance.now();
    this.record(input);

    return (completion = {}) =>
      this.record({
        ...input,
        ...completion,
        durationMs: performance.now() - startedAt,
        action: completion.action ?? `${input.action}.completed`,
        summary: completion.summary ?? `${input.summary} completed.`,
      });
  }

  /** Returns an immutable snapshot of retained events. */
  public snapshot(): readonly FlowEvent[] {
    return [...this.history];
  }

  /** Subscribes to newly recorded events. */
  public subscribe(listener: FlowListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Correlates normal Express requests and records their final status/time. */
  public readonly httpMiddleware: RequestHandler = (req, res, next) => {
    if (req.path === "/view-flow/events") {
      next();
      return;
    }

    const traceId =
      (typeof req.headers["x-request-id"] === "string" &&
        req.headers["x-request-id"]) ||
      randomUUID();
    const context: FlowContext = { traceId, transport: "http" };
    const startedAt = performance.now();
    const method = req.method;
    const requestPath = req.path;

    this.run(context, () => {
      this.record({
        stage: "http",
        action: "request.received",
        summary: `${method} ${requestPath} entered Express.`,
        details: {
          method,
          path: requestPath,
          contentType: req.headers["content-type"],
          contentLength: req.headers["content-length"],
        },
      });

      res.once("finish", () => {
        this.run(context, () => {
          this.record({
            stage: "http",
            level: res.statusCode >= 500 ? "error" : "success",
            action: "request.completed",
            summary: `${method} ${requestPath} returned ${res.statusCode}.`,
            durationMs: performance.now() - startedAt,
            details: { statusCode: res.statusCode },
          });
        });
      });

      next();
    });
  };

  /** Removes secrets, limits depth, and truncates large diagnostic values. */
  private sanitize(
    value: unknown,
    key = "",
    depth = 0,
    seen = new WeakSet<object>(),
  ): unknown {
    if (REDACTED_KEYS.test(key)) return "[REDACTED]";
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    if (typeof value === "string") {
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}…`
        : value;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === undefined
    ) {
      return value;
    }
    if (depth >= 4) return "[MAX_DEPTH]";
    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value
        .slice(0, 25)
        .map((item) => this.sanitize(item, key, depth + 1, seen));
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [
          entryKey,
          this.sanitize(entryValue, entryKey, depth + 1, seen),
        ]),
    );
  }

  /** Combines explicit and active correlation fields. */
  private mergeContext(
    current?: FlowContext,
    explicit?: Partial<FlowContext>,
  ): FlowContext | undefined {
    const traceId = explicit?.traceId ?? current?.traceId;
    if (!traceId) return undefined;
    return {
      traceId,
      transport: explicit?.transport ?? current?.transport,
      requestId: explicit?.requestId ?? current?.requestId,
      conversationId: explicit?.conversationId ?? current?.conversationId,
    };
  }
}

export const flowTracer = new FlowTracer();
