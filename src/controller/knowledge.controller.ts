import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

import { env } from "@app/config";
import { chromaKnowledgeService } from "@app/knowledge";
import { logError } from "@app/utils/error-logger";

const authorized = (request: Request): boolean => {
  const expected = env.RAG_INDEX_TOKEN;
  const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
};

/** Handles administrative knowledge-index operations. */
export class KnowledgeController {
  public reindex = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    if (!authorized(request)) {
      response.status(401).json({
        success: false,
        message: "A valid indexing token is required.",
      });
      return;
    }

    try {
      const result = await chromaKnowledgeService.reindex();
      response.status(200).json({ success: true, ...result });
    } catch (error) {
      logError("Chroma knowledge reindex failed", error);
      response.status(503).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Knowledge indexing failed.",
      });
    }
  };
}
