// Cloudflare D1 Document Repository (Document Lifecycle & Hierarchy Persistence)

import { ParsedDocument, RagChunk, ProcessingStatus } from '../document/types';

export class D1DocumentRepository {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Creates initial document record with UPLOADED status
   */
  public async createInitialRecord(docId: string, fileName: string, r2Key: string): Promise<void> {
    await this.db.prepare(
      `INSERT INTO document_records (doc_id, file_name, r2_key, processing_status, created_at)
       VALUES (?, ?, ?, 'UPLOADED', ?)`
    ).bind(docId, fileName, r2Key, new Date().toISOString()).run();
  }

  /**
   * Updates document processing status (PROCESSING, READY, FAILED)
   */
  public async updateStatus(
    docId: string,
    status: ProcessingStatus,
    details?: {
      totalPages?: number;
      totalChunks?: number;
      extractionMethod?: string;
      errorCode?: string;
      errorMessage?: string;
    }
  ): Promise<void> {
    const totalPages = details?.totalPages ?? 1;
    const totalChunks = details?.totalChunks ?? 0;
    const extractionMethod = details?.extractionMethod || 'pdf_flatedecode';
    const errorCode = details?.errorCode || null;
    const errorMessage = details?.errorMessage || null;
    const processedAt = status === 'READY' || status === 'FAILED' ? new Date().toISOString() : null;

    await this.db.prepare(
      `UPDATE document_records
       SET processing_status = ?,
           total_pages = ?,
           total_chunks = ?,
           extraction_method = ?,
           processed_at = ?,
           error_code = ?,
           error_message = ?
       WHERE doc_id = ?`
    ).bind(status, totalPages, totalChunks, extractionMethod, processedAt, errorCode, errorMessage, docId).run();
  }

  /**
   * Persists parsed document sections into D1 Database
   */
  public async saveSections(docId: string, sections: ParsedDocument['sections']): Promise<void> {
    if (!sections || sections.length === 0) return;

    for (const sec of sections) {
      await this.db.prepare(
        `INSERT OR REPLACE INTO document_sections (id, document_id, title, section_path, page_start, page_end, content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sec.id,
        docId,
        sec.title || 'Untitled Section',
        JSON.stringify(sec.sectionPath || []),
        sec.pageStart || 1,
        sec.pageEnd || 1,
        sec.content
      ).run();
    }
  }

  /**
   * Persists structure-aware chunks into D1 Database
   */
  public async saveChunks(docId: string, chunks: RagChunk[]): Promise<void> {
    if (!chunks || chunks.length === 0) return;

    for (const chunk of chunks) {
      await this.db.prepare(
        `INSERT OR REPLACE INTO document_chunks 
         (id, document_id, section_id, chunk_index, chunk_type, content, token_count, content_hash, embedding_version, page_start, page_end, metadata_json, vector_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        chunk.id,
        docId,
        chunk.sectionId || null,
        chunk.metadata.chunkIndex,
        chunk.chunkType,
        chunk.content,
        chunk.tokenCount,
        chunk.contentHash,
        chunk.embeddingVersion || 'v1',
        chunk.pageStart || 1,
        chunk.pageEnd || 1,
        JSON.stringify(chunk.metadata),
        chunk.id
      ).run();
    }
  }

  /**
   * Fetches document record by doc_id
   */
  public async getDocumentRecord(docId: string): Promise<any> {
    return await this.db.prepare('SELECT * FROM document_records WHERE doc_id = ?').bind(docId).first();
  }
}
