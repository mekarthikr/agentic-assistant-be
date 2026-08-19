import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { env } from "@app/config/env";
import type { DocumentRecord, DocumentStatus } from "@app/types";

type DocumentRow = {
  id: string;
  user_id: string;
  name: string;
  media_type: string;
  size: number;
  status: DocumentStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** Persists document lifecycle state independently from Chroma vectors. */
export class DocumentRepository {
  private readonly database: DatabaseSync;

  public constructor(path = env.RAG_DATABASE_PATH) {
    if (path !== ":memory:") {
      const absolutePath = resolve(path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      path = absolutePath;
    }
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('uploading','processing','ready','failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rag_documents_user_status
        ON rag_documents(user_id, status);
    `);
  }

  public create(record: DocumentRecord): DocumentRecord {
    this.database
      .prepare(
        `
        INSERT INTO rag_documents
          (id, user_id, name, media_type, size, status, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        record.id,
        record.userId,
        record.name,
        record.mediaType,
        record.size,
        record.status,
        record.error ?? null,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public updateStatus(
    id: string,
    userId: string,
    status: DocumentStatus,
    error?: string,
  ): DocumentRecord | undefined {
    this.database
      .prepare(
        `
        UPDATE rag_documents
        SET status = ?, error = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      )
      .run(status, error ?? null, new Date().toISOString(), id, userId);
    return this.findOwned(id, userId);
  }

  public findOwned(id: string, userId: string): DocumentRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM rag_documents WHERE id = ? AND user_id = ?")
      .get(id, userId) as DocumentRow | undefined;
    return row ? this.map(row) : undefined;
  }

  public listOwned(userId: string): DocumentRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM rag_documents WHERE user_id = ? ORDER BY created_at DESC",
        )
        .all(userId) as unknown as DocumentRow[]
    ).map(this.map);
  }

  public listReadyOwned(
    userId: string,
    documentIds?: readonly string[],
  ): DocumentRecord[] {
    const ready = this.listOwned(userId).filter(
      ({ status }) => status === "ready",
    );
    if (!documentIds?.length) return ready;
    const selected = new Set(documentIds);
    return ready.filter(({ id }) => selected.has(id));
  }

  public deleteOwned(id: string, userId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM rag_documents WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return result.changes > 0;
  }

  public replace(record: DocumentRecord): DocumentRecord {
    this.database
      .prepare(
        `
        INSERT INTO rag_documents
          (id, user_id, name, media_type, size, status, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          name = excluded.name,
          media_type = excluded.media_type,
          size = excluded.size,
          status = excluded.status,
          error = excluded.error,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        record.id,
        record.userId,
        record.name,
        record.mediaType,
        record.size,
        record.status,
        record.error ?? null,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public close(): void {
    this.database.close();
  }

  private readonly map = (row: DocumentRow): DocumentRecord => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mediaType: row.media_type,
    size: row.size,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
