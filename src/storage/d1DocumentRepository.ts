// Cloudflare D1 Document Repository (Document Lifecycle & Hierarchy Persistence)

import { ParsedDocument, RagChunk, ProcessingStatus } from '../core/types';

export interface CreateDocumentRecordOptions {
  docId: string;
  fileName: string;
  r2Key: string;
  tenantId?: string;
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
   * Auto-migrates missing columns for existing D1 tables safely
   */
  private async ensureSchemaColumns(): Promise<void> {
    const alterStatements = [
      `ALTER TABLE document_records ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default'`,
      `ALTER TABLE document_records ADD COLUMN user_id TEXT DEFAULT 'user_default'`,
      `ALTER TABLE document_records ADD COLUMN version TEXT DEFAULT 'v1'`,
      `ALTER TABLE document_records ADD COLUMN is_active INTEGER DEFAULT 1`,
      `ALTER TABLE document_records ADD COLUMN parent_doc_id TEXT`,
      `ALTER TABLE document_records ADD COLUMN total_pages INTEGER DEFAULT 1`,
      `ALTER TABLE document_records ADD COLUMN total_chunks INTEGER DEFAULT 0`,
      `ALTER TABLE document_records ADD COLUMN processing_status TEXT DEFAULT 'UPLOADED'`,
      `ALTER TABLE document_records ADD COLUMN processing_version TEXT DEFAULT 'v3.0'`,
      `ALTER TABLE document_records ADD COLUMN pipeline_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_records ADD COLUMN parser_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_records ADD COLUMN chunker_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_records ADD COLUMN embedding_model TEXT DEFAULT '@cf/baai/bge-m3'`,
      `ALTER TABLE document_records ADD COLUMN extraction_method TEXT`,
      `ALTER TABLE document_records ADD COLUMN processed_at DATETIME`,
      `ALTER TABLE document_records ADD COLUMN indexed_at DATETIME`,
      `ALTER TABLE document_records ADD COLUMN error_code TEXT`,
      `ALTER TABLE document_records ADD COLUMN error_message TEXT`,
      `ALTER TABLE document_records ADD COLUMN retry_count INTEGER DEFAULT 0`,
      `ALTER TABLE document_records ADD COLUMN is_demo INTEGER DEFAULT 0`,
      `ALTER TABLE document_records ADD COLUMN uploaded_by TEXT DEFAULT 'system'`,
      `ALTER TABLE document_sections ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default'`,
      `ALTER TABLE document_chunks ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default'`,
      `ALTER TABLE document_chunks ADD COLUMN parent_chunk_id TEXT`,
      `ALTER TABLE document_chunks ADD COLUMN pipeline_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_chunks ADD COLUMN parser_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_chunks ADD COLUMN chunker_version TEXT DEFAULT 'v1.0'`,
      `ALTER TABLE document_chunks ADD COLUMN embedding_model TEXT DEFAULT '@cf/baai/bge-m3'`,
      `ALTER TABLE chat_logs ADD COLUMN tenant_id TEXT DEFAULT 'tenant_default'`
    ];

    for (const stmt of alterStatements) {
      try {
        await this.db.prepare(stmt).run();
      } catch {
        // Ignore duplicate column name or table not created errors
      }
    }
  }

  /**
   * Creates initial document record with UPLOADED status
   */
  public async createInitialRecord(options: CreateDocumentRecordOptions | string, fileName?: string, r2Key?: string): Promise<void> {
    await this.ensureSchemaColumns();

    let docId: string;
    let name: string;
    let key: string;
    let tenantId = 'tenant_default';
    let userId = 'user_default';
    let version = 'v1';
    let parentDocId: string | null = null;

    if (typeof options === 'object') {
      docId = options.docId;
      name = options.fileName;
      key = options.r2Key;
      tenantId = options.tenantId || 'tenant_default';
      userId = options.userId || 'user_default';
      version = options.version || 'v1';
      parentDocId = options.parentDocId || null;
    } else {
      docId = options;
      name = fileName || 'document.pdf';
      key = r2Key || `documents/${docId}/original.pdf`;
    }

    await this.db.prepare(
      `INSERT OR IGNORE INTO document_records (doc_id, file_name, r2_key, tenant_id, user_id, version, is_active, parent_doc_id, total_pages, total_chunks, processing_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, 0, 'UPLOADED', ?)`
    ).bind(docId, name, key, tenantId, userId, version, parentDocId, new Date().toISOString()).run();
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
  public async saveSections(docId: string, sections: ParsedDocument['sections'], tenantId = 'tenant_default'): Promise<void> {
    if (!sections || sections.length === 0) return;

    for (const sec of sections) {
      await this.db.prepare(
        `INSERT OR REPLACE INTO document_sections (id, document_id, tenant_id, title, section_path, page_start, page_end, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sec.id,
        docId,
        tenantId,
        sec.title || 'Untitled Section',
        JSON.stringify(sec.sectionPath || []),
        sec.pageStart || 1,
        sec.pageEnd || 1,
        sec.content
      ).run();
    }
  }

  /**
   * Persists structure-aware chunks into D1 Database & FTS Index
   */
  public async saveChunks(docId: string, chunks: RagChunk[], tenantId = 'tenant_default'): Promise<void> {
    if (!chunks || chunks.length === 0) return;

    const statements = chunks.map((chunk, idx) => {
      const vectorId = chunk.id;
      const metadataStr = typeof chunk.metadata === 'string' ? chunk.metadata : JSON.stringify(chunk.metadata || {});
      return this.db.prepare(
        `INSERT OR REPLACE INTO document_chunks 
         (id, document_id, tenant_id, section_id, parent_chunk_id, chunk_index, chunk_type, content, token_count, content_hash, embedding_version, page_start, page_end, metadata_json, vector_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        chunk.id,
        docId,
        chunk.tenantId || tenantId,
        chunk.sectionId || null,
        chunk.parentChunkId || chunk.metadata.parentChunkId || null,
        chunk.metadata.chunkIndex ?? idx,
        chunk.chunkType || 'paragraph',
        chunk.content,
        chunk.tokenCount || 0,
        chunk.contentHash || `${chunk.id}_hash`,
        chunk.embeddingVersion || 'bge-m3-v1',
        chunk.pageStart || 1,
        chunk.pageEnd || 1,
        metadataStr,
        vectorId
      );
    });

    const BATCH_SIZE = 50;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const batch = statements.slice(i, i + BATCH_SIZE);
      await this.db.batch(batch);
    }
    
    const ftsStatements = chunks.map(chunk => {
      return this.db.prepare(
        `INSERT OR REPLACE INTO document_chunks_fts (chunk_id, document_id, content) VALUES (?, ?, ?)`
      ).bind(chunk.id, docId, chunk.content);
    });

    for (let i = 0; i < ftsStatements.length; i += BATCH_SIZE) {
      try {
        await this.db.batch(ftsStatements.slice(i, i + BATCH_SIZE));
      } catch {}
    }
  }

  /**
   * Fetches neighbor chunks (previous, current, next) from D1 for Parent Context Expansion
   */
  public async getNeighborChunks(docId: string, chunkIndex: number): Promise<Array<{ chunk_index: number; content: string; page_start?: number; page_end?: number }>> {
    try {
      const minIndex = Math.max(0, chunkIndex - 1);
      const maxIndex = chunkIndex + 1;
      const { results } = await this.db.prepare(
        `SELECT chunk_index, content, page_start, page_end FROM document_chunks 
         WHERE document_id = ? AND chunk_index BETWEEN ? AND ? 
         ORDER BY chunk_index ASC`
      ).bind(docId, minIndex, maxIndex).all<{ chunk_index: number; content: string; page_start?: number; page_end?: number }>();

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
   * Performs Sparse / Keyword search on document_chunks using D1 FTS5 or LIKE fallback (Flow §14)
   */
  public async searchChunksByKeywords(docId: string, keywords: string[], limit = 20): Promise<Array<{ chunkId: string; content: string; metadata: any }>> {
    if (!keywords || keywords.length === 0) return [];

    const validKeywords = keywords.slice(0, 5).filter(k => k.trim().length > 1);
    if (validKeywords.length === 0) return [];

    // 1. Try D1 FTS5 Virtual Table Search
    try {
      const ftsQuery = validKeywords.map(k => `"${k.replace(/"/g, '')}"`).join(' OR ');
      const ftsSql = `SELECT c.id, c.content, c.page_start, c.page_end, c.chunk_index, c.metadata_json 
                      FROM document_chunks_fts f 
                      JOIN document_chunks c ON f.chunk_id = c.id 
                      WHERE f.document_id = ? AND f.content MATCH ? 
                      LIMIT ?`;

      const { results } = await this.db.prepare(ftsSql).bind(docId, ftsQuery, limit).all<any>();
      if (results && results.length > 0) {
        return results.map((r: any) => {
          let meta: any = {};
          try { meta = JSON.parse(r.metadata_json || '{}'); } catch {}
          return {
            chunkId: r.id,
            content: r.content,
            metadata: {
              docId,
              fileName: meta.fileName || 'document.pdf',
              pageStart: r.page_start || 1,
              pageEnd: r.page_end || 1,
              sectionTitle: meta.sectionTitle || 'Nội dung tài liệu',
              sectionPath: meta.sectionPath || [],
              chunkIndex: r.chunk_index || 0,
              text: r.content
            }
          };
        });
      }
    } catch {}

    // 2. Parameterized SQL LIKE Fallback
    try {
      const likeClauses = validKeywords.map(() => `content LIKE ?`).join(' OR ');
      const sql = `SELECT id, content, page_start, page_end, chunk_index, metadata_json 
                   FROM document_chunks 
                   WHERE document_id = ? AND (${likeClauses}) 
                   ORDER BY chunk_index ASC 
                   LIMIT ?`;

      const params: any[] = [docId];
      for (const kw of validKeywords) {
        params.push(`%${kw.trim()}%`);
      }
      params.push(limit);

      const { results } = await this.db.prepare(sql).bind(...params).all<any>();
      if (!results || results.length === 0) return [];

      return results.map((r: any) => {
        let meta: any = {};
        try { meta = JSON.parse(r.metadata_json || '{}'); } catch {}
        return {
          chunkId: r.id,
          content: r.content,
          metadata: {
            docId,
            fileName: meta.fileName || 'document.pdf',
            pageStart: r.page_start || 1,
            pageEnd: r.page_end || 1,
            sectionTitle: meta.sectionTitle || 'Nội dung tài liệu',
            sectionPath: meta.sectionPath || [],
            chunkIndex: r.chunk_index || 0,
            text: r.content
          }
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches all chunks of a document directly from D1 SQLite as a reliable fallback
   */
  public async getAllChunks(docId: string): Promise<Array<{ chunkId: string; content: string; metadata: any }>> {
    try {
      const { results } = await this.db.prepare(
        `SELECT id, content, page_start, page_end, chunk_index, metadata_json 
         FROM document_chunks 
         WHERE document_id = ? 
         ORDER BY chunk_index ASC 
         LIMIT 500`
      ).bind(docId).all<any>();

      if (!results || results.length === 0) return [];

      return results.map((r: any) => {
        let meta: any = {};
        try { meta = JSON.parse(r.metadata_json || '{}'); } catch {}
        return {
          chunkId: r.id,
          content: r.content,
          metadata: {
            docId,
            fileName: meta.fileName || 'document.pdf',
            pageStart: r.page_start || 1,
            pageEnd: r.page_end || 1,
            sectionTitle: meta.sectionTitle || 'Nội dung tài liệu',
            sectionPath: meta.sectionPath || [],
            chunkIndex: r.chunk_index || 0,
            text: r.content
          }
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches all active documents (is_active = 1) for a given tenant/user scope
   */
  public async listActiveDocuments(userId = 'user_default', tenantId = 'tenant_default'): Promise<any[]> {
    await this.ensureSchemaColumns();

    const { results } = await this.db.prepare(
      `SELECT doc_id, file_name, tenant_id, user_id, version, is_active, total_pages, total_chunks, processing_status, is_demo, created_at 
       FROM document_records 
       WHERE is_active = 1 
         AND (user_id = ? OR ? = 'user_default')
         AND (tenant_id = ? OR ? = 'tenant_default')
       ORDER BY created_at DESC`
    ).bind(userId, userId, tenantId, tenantId).all();
    return results || [];
  }
}
