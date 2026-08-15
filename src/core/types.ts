export type ProcessingStatus = 
  | 'UPLOADING'
  | 'UPLOADED' 
  | 'PARSING'
  | 'CHUNKING' 
  | 'EMBEDDING' 
  | 'INDEXING' 
  | 'READY' 
  | 'FAILED'
  | 'DELETING'
  | 'DELETED';

export type AgentRole = 'SUPERVISOR' | 'RAG_AGENT' | 'SQL_AGENT' | 'AUDITOR';
export type AgentStatus = 'THINKING' | 'EXECUTING' | 'DONE' | 'ERROR';
export type UserIntent = 'RAG_ONLY' | 'SQL_ONLY' | 'HYBRID_AUDIT' | 'GENERAL_CHAT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';

export interface ChunkMetadata {
  docId: string;
  tenantId?: string;
  fileName: string;
  chunkIndex: number;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  sectionPath?: string[];
  parentChunkId?: string;
  tokenCount?: number;
  containsTable?: boolean;
  text?: string;
  documentType?: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  tenantId?: string;
  sectionId?: string;
  parentChunkId?: string;
  content: string;
  chunkType: 'text' | 'table' | 'header';
  tokenCount: number;
  contentHash?: string;
  embeddingVersion?: string;
  pageStart?: number;
  pageEnd?: number;
  metadata: ChunkMetadata;
}

export interface ParsedDocumentSection {
  id: string;
  title?: string;
  sectionPath: string[];
  pageStart?: number;
  pageEnd?: number;
  content: string;
}

export interface ParsedDocument {
  documentId: string;
  tenantId?: string;
  sections: ParsedDocumentSection[];
  metadata: {
    fileName: string;
    pageCount: number;
    extractionMethod: string;
  };
  warnings?: string[];
}

export interface RetrievalScope {
  tenantId: string;
  userId?: string;
  documentIds?: string[];
}

export interface GroundedSynthesisResult {
  answer: string;
  citations: Citation[];
  auditReport?: AuditReport;
}

export interface Citation {
  documentId?: string;
  documentName: string;
  sectionTitle?: string;
  sectionPath?: string[];
  pageStart?: number;
  pageEnd?: number;
  chunkId?: string;
  r2ViewUrl?: string;
}

export interface AuditReport {
  auditId?: string;
  contractRef?: string;
  discrepancies?: string[];
  complianceStatus?: 'PASSED' | 'FAILED';
  summary?: string;
  discrepancyFound?: boolean;
  pdfClaim?: string;
  dbRecord?: string;
  varianceUsd?: number;
  variancePercentage?: number;
  riskLevel: RiskLevel;
  explanation?: string;
}

export interface AgentThoughtStep {
  agent: string;
  status: string;
  thought: string;
  data?: unknown;
  timestamp: number;
}

export interface MultiAgentState {
  sessionId: string;
  traceId: string;
  userPrompt: string;
  selectedDocId?: string;
  intent?: UserIntent;
  ragContext?: string;
  sqlQuery?: string;
  sqlResult?: Record<string, unknown>[];
  sqlData?: any;
  auditReport?: AuditReport;
  thoughtProcess: AgentThoughtStep[];
  citations?: Citation[];
  finalAnswer: string;
}

export interface RagContextChunk {
  text: string;
  source: string;
  page: number;
  score: number;
  containsTable?: boolean;
}

export interface PageTextQuality {
  pageNumber: number;
  printableRatio: number;
  replacementCharRatio: number;
  weirdSpacingRatio: number;
  singleCharacterTokenRatio: number;
  alphabeticRatio: number;
  textDensity: number;
  extractedCharacterCount: number;
  isValid: boolean;
  score: number;
  reason?: string;
}
