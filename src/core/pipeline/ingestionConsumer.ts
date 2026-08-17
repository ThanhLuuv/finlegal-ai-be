// Async Document Ingestion Consumer (Stage 1 Architecture Diagram)
// Coordinates: R2 Raw Upload -> Text Extractor -> Custom Recursive Chunking -> Workers AI bge-m3 Embedding -> Multi-Store Idempotent Write (Vectorize, D1, R2)

import { UniversalTextExtractor } from '../extraction/textExtractor';
import { RecursiveCharacterTextSplitter, StructuredRagChunk } from '../chunking/recursiveSplitter';
import { D1DocumentRepository } from '../../storage/d1DocumentRepository';
import { VectorRepository } from '../../storage/vectorRepository';
import { R2DocumentRepository } from '../../storage/r2Repository';
import { LLMProviderService } from '../../services/llm';

export interface IngestionJobResult {
  success: boolean;
  docId: string;
  fileName: string;
  totalChunks: number;
  message: string;
}

import { DocumentServiceClient } from '../extraction/extractionClient';

export class IngestionConsumer {
  private extractor: UniversalTextExtractor;
  private splitter: RecursiveCharacterTextSplitter;
  private d1Repo: D1DocumentRepository;
  private vectorRepo: VectorRepository;
  private r2Repo: R2DocumentRepository;

  constructor(
    db: D1Database,
    vectorize: VectorizeIndex,
    r2: R2Bucket,
    ai: Ai,
    serviceUrl?: string,
    secretToken?: string
  ) {
    const serviceClient = new DocumentServiceClient(serviceUrl, secretToken);
    this.extractor = new UniversalTextExtractor(ai, serviceClient);
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSizeTokens: 700,
      chunkOverlapTokens: 135
    });
    this.d1Repo = new D1DocumentRepository(db);
    this.vectorRepo = new VectorRepository(vectorize, ai);
    this.r2Repo = new R2DocumentRepository(r2);
  }

  /**
   * Executes complete Async Ingestion Pipeline (Stage 1 Diagram):
   * 1. Store raw original file in R2 & Initial D1 record
   * 2. Parse & extract text
   * 3. Recursive Character Chunking (600-800 tokens, 120-150 overlap)
   * 4. Workers AI BGE-M3 Embedding
   * 5. Idempotent Multi-Store Sync: Vectorize, D1 Database, R2 Chunk Storage
   */
  public async processIngestionJob(
    docId: string,
    fileName: string,
    buffer: ArrayBuffer,
    options?: { userId?: string; version?: string; parentDocId?: string; r2Key?: string }
  ): Promise<IngestionJobResult> {
    let retryCount = 0;
    const maxRetries = 2;

    // Step 1: Save raw original file in R2 & Initial D1 Record
    const r2Key = options?.r2Key || await this.r2Repo.uploadDocument(docId, fileName, buffer);
    await this.d1Repo.createInitialRecord({
      docId,
      fileName,
      r2Key,
      userId: options?.userId,
      version: options?.version || 'v1',
      parentDocId: options?.parentDocId
    });

    while (retryCount <= maxRetries) {
      try {
        // Step 2: Transition to PARSING status & Extract Text
        await this.d1Repo.updateStatus(docId, 'PARSING', { retryCount });
        const extracted = await this.extractor.extract(buffer, fileName, docId);

        // Step 3: Transition to CHUNKING status & Recursive Character Splitting
        await this.d1Repo.updateStatus(docId, 'CHUNKING', { totalPages: extracted.pageCount, retryCount });
        const chunks: StructuredRagChunk[] = this.splitter.splitText(extracted.text, docId, fileName);

        if (chunks.length === 0) {
          throw new Error('Nội dung văn bản không có dữ liệu để cắt chunk.');
        }

        // Step 4: Transition to EMBEDDING status & Persist D1 Chunks
        await this.d1Repo.updateStatus(docId, 'EMBEDDING', {
          totalPages: extracted.pageCount,
          totalChunks: chunks.length,
          retryCount
        });

        // Save chunks to D1 Database
        const ragChunksForD1 = chunks.map(c => ({
          id: c.id,
          documentId: docId,
          tenantId: c.tenantId,
          content: c.content,
          tokenCount: c.tokenCount,
          chunkType: c.chunkType,
          contentHash: `${c.id}_hash`,
          embeddingVersion: 'bge-m3-v1',
          pageStart: c.metadata.pageStart,
          pageEnd: c.metadata.pageEnd,
          metadata: c.metadata
        }));

        await this.d1Repo.saveChunks(docId, ragChunksForD1 as any);

        // Upload long chunk texts to R2 as pointers if content > 1500 chars in parallel batches of 20
        const longChunks = chunks.filter(c => c.content.length > 1500);
        const PARALLEL_BATCH = 20;
        for (let i = 0; i < longChunks.length; i += PARALLEL_BATCH) {
          const batch = longChunks.slice(i, i + PARALLEL_BATCH);
          await Promise.all(batch.map(c => this.r2Repo.uploadChunkText(docId, c.id, c.content)));
        }

        // Step 5: Transition to INDEXING status & Upsert to Vectorize Index (`bge-m3`)
        await this.d1Repo.updateStatus(docId, 'INDEXING', {
          totalPages: extracted.pageCount,
          totalChunks: chunks.length,
          retryCount
        });
        await this.vectorRepo.upsertChunks(ragChunksForD1 as any);

        // If updating version, deactivate older versions
        if (options?.parentDocId) {
          await this.d1Repo.deactivateOlderVersions(options.parentDocId, docId);
        }

        // Step 6: Transition to READY status
        await this.d1Repo.updateStatus(docId, 'READY', {
          totalPages: extracted.pageCount,
          totalChunks: chunks.length,
          extractionMethod: extracted.extractionMethod,
          retryCount
        });

        return {
          success: true,
          docId,
          fileName,
          totalChunks: chunks.length,
          message: 'Tài liệu đã được nạp dữ liệu không đồng bộ, tạo Vector bge-m3 và lưu trữ an toàn.'
        };
      } catch (err) {
        retryCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (retryCount > maxRetries) {
          await this.d1Repo.updateStatus(docId, 'FAILED', {
            errorCode: 'INGESTION_FAILED',
            errorMessage: errorMsg,
            retryCount
          });
          throw new Error(`Xử lý nạp dữ liệu thất bại sau ${maxRetries} lần thử: ${errorMsg}`);
        }

        await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      }
    }

    throw new Error('Pipeline ingestion execution failed unexpectedly.');
  }
}
