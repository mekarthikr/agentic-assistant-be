import { Router } from "express";
import multer from "multer";

import { env } from "@app/config/env";
import { documentService } from "@app/config/rag";
import {
  requireAuthenticatedUser,
  type AuthenticatedRequest,
} from "@app/middleware/auth.middleware";
import { isSupportedDocumentName } from "@app/service/document-parser.service";
import { logError } from "@app/utils/error-logger";
import type { DocumentRecord } from "@app/types";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.RAG_MAX_UPLOAD_BYTES, files: 1 },
});
const firstParameter = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);
const toPublicDocument = ({ userId: _userId, ...document }: DocumentRecord) => {
  void _userId;
  return document;
};

export const documentRoutes = Router();
documentRoutes.use(requireAuthenticatedUser);

documentRoutes.get("/", (request: AuthenticatedRequest, response) => {
  response.json({
    success: true,
    documents: documentService.list(request.userId!).map(toPublicDocument),
  });
});

const processUpload = async (
  request: AuthenticatedRequest,
  response: import("express").Response,
): Promise<void> => {
  if (!request.file) {
    response
      .status(400)
      .json({ success: false, message: "A document file is required." });
    return;
  }
  if (!isSupportedDocumentName(request.file.originalname)) {
    response.status(415).json({
      success: false,
      message:
        "Unsupported document type. Upload a PDF, DOCX, TXT, or MD file.",
    });
    return;
  }
  try {
    const documentId = firstParameter(request.params.documentId);
    const document = await documentService.ingest({
      userId: request.userId!,
      name: request.file.originalname,
      mediaType: request.file.mimetype || "application/octet-stream",
      buffer: request.file.buffer,
      ...(documentId ? { documentId } : {}),
    });
    response.status(request.params.documentId ? 200 : 201).json({
      success: true,
      document: toPublicDocument(document),
    });
  } catch (error) {
    logError("Document upload processing failed", error, {
      userId: request.userId,
      documentId: request.params.documentId,
      documentName: request.file.originalname,
    });
    response.status(422).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Document processing failed.",
    });
  }
};

documentRoutes.post("/", upload.single("document"), (request, response) => {
  void processUpload(request, response);
});

documentRoutes.put(
  "/:documentId",
  upload.single("document"),
  (request, response) => {
    void processUpload(request, response);
  },
);

documentRoutes.delete(
  "/:documentId",
  async (request: AuthenticatedRequest, response) => {
    try {
      const deleted = await documentService.delete(
        firstParameter(request.params.documentId)!,
        request.userId!,
      );
      if (!deleted) {
        response
          .status(404)
          .json({ success: false, message: "Document not found." });
        return;
      }
      response.status(204).end();
    } catch (error) {
      logError("Document deletion failed", error, {
        userId: request.userId,
        documentId: request.params.documentId,
      });
      response.status(503).json({
        success: false,
        message: "The document could not be removed from the search index.",
      });
    }
  },
);

documentRoutes.use(
  (
    error: unknown,
    _request: AuthenticatedRequest,
    response: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        success: false,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? `Documents are limited to ${env.RAG_MAX_UPLOAD_BYTES} bytes.`
            : "The document upload was invalid.",
      });
      return;
    }
    next(error);
  },
);
