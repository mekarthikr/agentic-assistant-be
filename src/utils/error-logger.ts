type ErrorContext = Readonly<Record<string, unknown>>;
type LogLevel = "error" | "warn";

const SENSITIVE_KEY_PATTERN =
  /authorization|api[-_]?key|password|secret|cookie|access[-_]?token/i;
const MAX_SERIALIZATION_DEPTH = 8;

const serializeValue = (
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SERIALIZATION_DEPTH) return "[maximum depth reached]";
  if (seen.has(value)) return "[circular reference]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, seen, depth + 1));
  }

  const serialized: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      serialized[key] = "[redacted]";
      continue;
    }

    try {
      serialized[key] = serializeValue(
        (value as Record<string, unknown>)[key],
        seen,
        depth + 1,
      );
    } catch (serializationError) {
      serialized[key] =
        serializationError instanceof Error
          ? `[unavailable: ${serializationError.message}]`
          : "[unavailable]";
    }
  }

  if (value instanceof Error) {
    serialized.name = value.name;
    serialized.message = value.message;
    serialized.stack = value.stack;
  }

  return serialized;
};

/** Produces a JSON-safe representation including non-enumerable Error fields. */
export const serializeError = (error: unknown): unknown =>
  serializeValue(error, new WeakSet<object>(), 0);

/**
 * Logs structured, recursively serialized details and the original error.
 * Credential-like object fields are redacted from the structured copy.
 */
export const logError = (
  message: string,
  error: unknown,
  context: ErrorContext = {},
  level: LogLevel = "error",
): void => {
  const details = {
    timestamp: new Date().toISOString(),
    ...context,
    error: serializeError(error),
  };

  console[level](message, details, { rawError: error });
};
