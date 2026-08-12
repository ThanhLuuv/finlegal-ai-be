// Generic Document Ingestion Pipeline Orchestrator
// Coordinates Extraction -> Normalization -> Validation -> Hierarchy Chunking -> Persistence

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
    this.extractorFactory = new DocumentExtractorFactory();
    this.structureParser = new StructureParser(llm);
    this.structureValidator = new StructureValidator();
    this.structureChunker = new StructureChunker();
    this.d1Repo = new D1DocumentRepository(db);
    this.vectorRepo = new VectorRepository(vectorize, ai);
    this.r2Repo = new R2DocumentRepository(r2);
  }

  /**
   * Executes complete document ingestion pipeline
   */
  public async processDocument(docId: string, fileName: string, buffer: ArrayBuffer): Promise<PipelineResult> {
    try {
      // 1. Upload raw binary file to R2 Bucket
      const r2Key = await this.r2Repo.uploadDocument(docId, fileName, buffer);

      // 2. Register initial document status in D1
      await this.d1Repo.createInitialRecord(docId, fileName, r2Key);
      await this.d1Repo.updateStatus(docId, 'PROCESSING');

      // 3. Extract raw text & pages via DocumentExtractorFactory
      const rawExtractedDoc = await this.extractorFactory.extract(buffer, fileName);

      // 4. Normalize structure via LLM StructureParser (Fact-Preserving)
      const unvalidatedDoc = await this.structureParser.parse(rawExtractedDoc, docId, fileName);

      // 5. Validate fact consistency & structure integrity
      const validation = this.structureValidator.validate(unvalidatedDoc);
      const parsedDoc = validation.validatedDocument;

      // 6. Build hierarchy & clause-aware RAG chunks
      const chunks: RagChunk[] = this.structureChunker.chunk(parsedDoc);

      // 7. Persist sections & chunks to D1 Database
      await this.d1Repo.saveSections(docId, parsedDoc.sections);
      await this.d1Repo.saveChunks(docId, chunks);

      // 8. Index structure-aware vectors to Cloudflare Vectorize
      await this.vectorRepo.upsertChunks(chunks);

      // 9. Update final document status to READY
      await this.d1Repo.updateStatus(docId, 'READY', {
        totalPages: parsedDoc.metadata.pageCount,
        totalChunks: chunks.length,
        extractionMethod: rawExtractedDoc.extractionMethod
      });

      return {
        success: true,
        docId,
        fileName,
        totalChunks: chunks.length,
        parsedDocument: parsedDoc,
        warnings: parsedDoc.warnings || [],
        message: 'Tài liệu đã được phân tích cấu trúc và lưu trữ thành công vào kho Vector.'
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.d1Repo.updateStatus(docId, 'FAILED', {
        errorCode: 'INGESTION_ERROR',
        errorMessage: errorMsg
      });

      throw new Error(`Lỗi xử lý tài liệu (${fileName}): ${errorMsg}`);
    }
  }
}
