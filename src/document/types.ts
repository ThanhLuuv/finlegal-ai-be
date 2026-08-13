// Generic Production Document Model Types & Interfaces

export type ProcessingStatus = 
  | 'UPLOADED' 
  | 'PARSING' 
  | 'CHUNKING' 
  | 'EMBEDDING' 
  | 'INDEXING' 
  | 'READY' 
  | 'FAILED'
  | 'PROCESSING';

export type BlockType = 'heading' | 'paragraph' | 'table' | 'list' | 'clause' | 'section' | 'other';

export interface DocumentPage {
  pageNumber: number;
  content: string;
}

export interface DocumentBlock {
  id: string;
  type: BlockType;
  content: string;
  page?: number;
  level?: number;
  sectionTitle?: string;
  sectionPath?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
}

export interface DocumentSection {
  id: string;
  title?: string;
  sectionPath: string[];
  pageStart?: number;
  pageEnd?: number;
  content: string;
  level?: number;
}

export interface DocumentTable {
  id: string;
  page: number;
  headers: string[];
  rows: string[][];
  markdown: string;
}

export interface ParsedDocument {
  documentId: string;
  title?: string;
  pages: DocumentPage[];
  sections: DocumentSection[];
  blocks: DocumentBlock[];
  tables: DocumentTable[];
  metadata: {
    fileName: string;
    mimeType: string;
    pageCount: number;
    documentType: string;
    processingVersion: string;
    extractionMethod: string;
  };
  rawText: string;
  warnings: string[];
}

export interface ChunkMetadata {
  docId: string;
  fileName: string;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  sectionPath?: string[];
  chunkIndex: number;
  documentType: string;
  containsTable: boolean;
  text: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  sectionId?: string;
  content: string;
  chunkType: BlockType;
  tokenCount: number;
  contentHash: string;
  embeddingVersion: string;
  pageStart?: number;
  pageEnd?: number;
  metadata: ChunkMetadata;
}
