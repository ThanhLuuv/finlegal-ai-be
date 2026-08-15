// Generic Document Ingestion Pipeline Orchestrator (Flow A & Flow D)
// Coordinates Storage -> Parser -> Structure Analyzer -> Chunking -> BGE-M3 Embedding -> Vectorize Indexing

import { DocumentExtractorFactory } from './extraction/documentExtractor';
import { StructureParser } from './parsing/structureParser';
import { StructureValidator } from './parsing/structureValidator';
import { StructureChunker } from './chunking/structureChunker';
import { LLMProviderService } from '../services/llm';
import { D1DocumentRepository } from '../storage/d1DocumentRepository';
import { VectorRepository } from '../storage/vectorRepository';
import { R2DocumentRepository } from '../storage/r2Repository';
import { ParsedDocument, RagChunk } from './types';

export interface PipelineResult {
  success: boolean;
  docId: string;
  fileName: string;
  totalChunks: number;
  parsedDocument: ParsedDocument;
  warnings: string[];
  message: string;
}

export class DocumentPipeline {
  private extractorFactory: DocumentExtractorFactory;
  private structureParser: StructureParser;
  private structureValidator: StructureValidator;
  private structureChunker: StructureChunker;
  private d1Repo: D1DocumentRepository;
  private vectorRepo: VectorRepository;
  private r2Repo: R2DocumentRepository;

  constructor(
    llm: LLMProviderService,
    db: D1Database,
    vectorize: VectorizeIndex,
    r2: R2Bucket,
    ai: Ai
  ) {
    this.extractorFactory = new DocumentExtractorFactory(llm);
    this.structureParser = new StructureParser(llm);
    this.structureValidator = new StructureValidator();
    this.structureChunker = new StructureChunker();
    this.d1Repo = new D1DocumentRepository(db);
    this.vectorRepo = new VectorRepository(vectorize, ai);
    this.r2Repo = new R2DocumentRepository(r2);
  }

  /**
   * Executes complete document ingestion pipeline according to Flow A:
   * UPLOADED -> PARSING -> CHUNKING -> EMBEDDING -> INDEXING -> READY (or FAILED)
   */
  public async processDocument(
    docId: string, 
    fileName: string, 
    buffer: ArrayBuffer,
    options?: { userId?: string; version?: string; parentDocId?: string }
  ): Promise<PipelineResult> {
    let retryCount = 0;
    const maxRetries = 2;

    // Step 1: Upload raw binary file to Cloudflare R2 & Register initial record in D1 (Idempotent once)
    const r2Key = await this.r2Repo.uploadDocument(docId, fileName, buffer);
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
        // Step 2: Transition to PARSING status (Parser & OCR)
        await this.d1Repo.updateStatus(docId, 'PARSING', { retryCount });
        const rawExtractedDoc = await this.extractorFactory.extract(buffer, fileName);
        const unvalidatedDoc = await this.structureParser.parse(rawExtractedDoc, docId, fileName);
        const validation = this.structureValidator.validate(unvalidatedDoc);
        
        if (validation.status === 'REJECT') {
          throw new Error(`Cấu trúc tài liệu bị từ chối do không nhất quán dữ liệu.`);
        }
        
        const parsedDoc = validation.validatedDocument;

        console.log('1 RAW TEXT:\n', rawExtractedDoc.text.slice(0, 500));

        // Step 3: Transition to CHUNKING status (Structure Analyzer & Chunker)
        await this.d1Repo.updateStatus(docId, 'CHUNKING', { totalPages: parsedDoc.metadata.pageCount, retryCount });

        const chunks: RagChunk[] = this.structureChunker.chunk(parsedDoc);

        console.log('2 CHUNKS:\n', chunks.map((x, i) => `===== CHUNK ${i} (${x.metadata.sectionTitle}) =====\n${x.content.slice(0, 150)}...`).join('\n'));

        // Step 4: Transition to EMBEDDING status (BGE-M3 Embedding Model)
        await this.d1Repo.updateStatus(docId, 'EMBEDDING', { 
          totalPages: parsedDoc.metadata.pageCount, 
          totalChunks: chunks.length, 
          retryCount 
        });
        await this.d1Repo.saveSections(docId, parsedDoc.sections);
        await this.d1Repo.saveChunks(docId, chunks);

        // Step 5: Transition to INDEXING status (Vectorize Indexing)
        await this.d1Repo.updateStatus(docId, 'INDEXING', { 
          totalPages: parsedDoc.metadata.pageCount, 
          totalChunks: chunks.length, 
          retryCount 
        });
        await this.vectorRepo.upsertChunks(chunks);

        // If updating to a new version, deactivate older versions
        if (options?.parentDocId) {
          await this.d1Repo.deactivateOlderVersions(options.parentDocId);
        }

        // Step 6: Transition to READY status
        await this.d1Repo.updateStatus(docId, 'READY', {
          totalPages: parsedDoc.metadata.pageCount,
          totalChunks: chunks.length,
          extractionMethod: rawExtractedDoc.extractionMethod,
          retryCount
        });

        return {
          success: true,
          docId,
          fileName,
          totalChunks: chunks.length,
          parsedDocument: parsedDoc,
          warnings: parsedDoc.warnings || [],
          message: 'Tài liệu đã được phân tích cấu trúc, tạo Vector bge-m3 và sẵn sàng tra cứu.'
        };
      } catch (err) {
        retryCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (retryCount > maxRetries) {
          await this.d1Repo.updateStatus(docId, 'FAILED', {
            errorCode: 'PIPELINE_ERROR',
            errorMessage: errorMsg,
            retryCount
          });
          throw new Error(`Xử lý tài liệu thất bại sau ${maxRetries} lần thử: ${errorMsg}`);
        }

        // Short retry backoff delay
        await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      }
    }

    throw new Error('Pipeline execution failed unexpectedly.');
  }
}

