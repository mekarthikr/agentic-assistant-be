import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { env } from "@app/config/env";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

const tokensMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

/** Maps the existing verified application token to a server-owned user ID. */
export const requireAuthenticatedUser = (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void => {
  if (env.SOCKET_AUTH_TOKEN) {
    const authorization = request.header("authorization") ?? "";
    const [scheme, token] = authorization.split(" ");
    if (
      scheme?.toLowerCase() !== "bearer" ||
      !token ||
      !tokensMatch(token, env.SOCKET_AUTH_TOKEN)
    ) {
      response.status(401).json({ success: false, message: "Unauthorized." });
      return;
    }
  }
  request.userId = env.RAG_DEFAULT_USER_ID;
  next();
};
