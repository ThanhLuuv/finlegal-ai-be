// Cloudflare D1 Document Repository (Document Lifecycle & Hierarchy Persistence)

import { ParsedDocument, RagChunk, ProcessingStatus } from '../document/types';

export interface CreateDocumentRecordOptions {
  docId: string;
  fileName: string;
  r2Key: string;
  userId?: string;
  version?: string;
  parentDocId?: string;
}

export class D1DocumentRepository {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Creates initial document record with UPLOADED status
   */
  public async createInitialRecord(options: CreateDocumentRecordOptions | string, fileName?: string, r2Key?: string): Promise<void> {
    let docId: string;
    let name: string;
    let key: string;
    let userId = 'user_default';
    let version = 'v1';
    let parentDocId: string | null = null;

    if (typeof options === 'object') {
      docId = options.docId;
      name = options.fileName;
      key = options.r2Key;
      userId = options.userId || 'user_default';
      version = options.version || 'v1';
      parentDocId = options.parentDocId || null;
    } else {
      docId = options;
      name = fileName || 'document.pdf';
      key = r2Key || `documents/${docId}/original.pdf`;
    }

    await this.db.prepare(
      `INSERT INTO document_records (doc_id, file_name, r2_key, user_id, version, is_active, parent_doc_id, total_pages, total_chunks, processing_status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1, 0, 'UPLOADED', ?)`
    ).bind(docId, name, key, userId, version, parentDocId, new Date().toISOString()).run();
  }

  /**
   * Updates document processing status (UPLOADED, PARSING, CHUNKING, EMBEDDING, INDEXING, READY, FAILED)
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
      retryCount?: number;
    }
  ): Promise<void> {
    const totalPages = details?.totalPages ?? 1;
    const totalChunks = details?.totalChunks ?? 0;
    const extractionMethod = details?.extractionMethod || 'bge_m3_pipeline';
    const errorCode = details?.errorCode || null;
    const errorMessage = details?.errorMessage || null;
    const retryCount = details?.retryCount ?? 0;
    const processedAt = status === 'READY' || status === 'FAILED' ? new Date().toISOString() : null;

    await this.db.prepare(
      `UPDATE document_records
       SET processing_status = ?,
           total_pages = ?,
           total_chunks = ?,
           extraction_method = ?,
           processed_at = ?,
           error_code = ?,
           error_message = ?,
           retry_count = ?
       WHERE doc_id = ?`
    ).bind(status, totalPages, totalChunks, extractionMethod, processedAt, errorCode, errorMessage, retryCount, docId).run();
  }

  /**
   * Fetches all vector IDs associated with a document ID for exact deletion (Flow C §20)
   */
  public async getChunkVectorIds(docId: string): Promise<string[]> {
    try {
      const { results } = await this.db.prepare(
        'SELECT vector_id FROM document_chunks WHERE document_id = ?'
      ).bind(docId).all<{ vector_id: string }>();

      return (results || []).map(r => r.vector_id);
    } catch {
      return [];
    }
  }

  /**
   * Deletes document record and associated sections & chunks from D1 (Flow C §20)
   */
  public async deleteDocumentRecord(docId: string): Promise<void> {
    await this.db.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(docId).run();
    await this.db.prepare('DELETE FROM document_sections WHERE document_id = ?').bind(docId).run();
    await this.db.prepare('DELETE FROM document_records WHERE doc_id = ?').bind(docId).run();
  }

  /**
   * Deactivates old version while preserving current active version (Flow C §21)
   */
  public async deactivateOlderVersions(parentDocId: string, currentDocId?: string): Promise<void> {
    if (currentDocId) {
      await this.db.prepare(
        `UPDATE document_records SET is_active = 0 WHERE (doc_id = ? OR parent_doc_id = ?) AND doc_id != ?`
      ).bind(parentDocId, parentDocId, currentDocId).run();
    } else {
      await this.db.prepare(
        `UPDATE document_records SET is_active = 0 WHERE doc_id = ? OR parent_doc_id = ?`
      ).bind(parentDocId, parentDocId).run();
    }
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
        chunk.embeddingVersion || 'bge-m3-v1',
        chunk.pageStart || 1,
        chunk.pageEnd || 1,
        JSON.stringify(chunk.metadata),
        chunk.id
      ).run();
    }
  }

  /**
   * Fetches neighbor chunks (previous, current, next) from D1 for Parent Context Expansion
   */
  public async getNeighborChunks(docId: string, chunkIndex: number): Promise<Array<{ chunk_index: number; content: string }>> {
    try {
      const minIndex = Math.max(0, chunkIndex - 1);
      const maxIndex = chunkIndex + 1;
      const { results } = await this.db.prepare(
        `SELECT chunk_index, content FROM document_chunks 
         WHERE document_id = ? AND chunk_index BETWEEN ? AND ? 
         ORDER BY chunk_index ASC`
      ).bind(docId, minIndex, maxIndex).all<{ chunk_index: number; content: string }>();

      return results || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetches parent section content by section title
   */
  public async getSectionContent(docId: string, sectionTitle: string): Promise<string | null> {
    try {
      const record = await this.db.prepare(
        `SELECT content FROM document_sections WHERE document_id = ? AND title = ? LIMIT 1`
      ).bind(docId, sectionTitle).first<{ content: string }>();

      return record?.content || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches document record by doc_id
   */
  public async getDocumentRecord(docId: string): Promise<any> {
    return await this.db.prepare('SELECT * FROM document_records WHERE doc_id = ?').bind(docId).first();
  }

  /**
   * Fetches all active documents (is_active = 1)
   */
  public async listActiveDocuments(userId = 'user_default'): Promise<any[]> {
    const { results } = await this.db.prepare(
      'SELECT doc_id, file_name, user_id, version, is_active, total_pages, total_chunks, processing_status, created_at FROM document_records WHERE is_active = 1 ORDER BY created_at DESC'
    ).all();
    return results || [];
  }
}
