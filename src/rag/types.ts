import { SourceLocation } from '../document/types';

export interface Citation {
  documentId: string;
  documentName: string;
  sectionTitle?: string;
  sectionPath?: string[];
  pageStart?: number;
  pageEnd?: number;
  chunkId: string;
  sourceLocation?: SourceLocation;
}

export interface EvidenceBlock {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  vectorScore?: number;
  lexicalScore?: number;
  rrfScore?: number;
  citation: Citation;
}

export interface RetrievalScope {
  tenantId: string;
  userId?: string;
  documentIds?: string[];
  folderIds?: string[];
  versionIds?: string[];
  authorizedDocumentIds?: string[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface QueryAnalysis {
  originalQuery: string;
  rewrittenQuery: string;
  keywords: string[];
  targetDocId?: string;
  documentTypeFilter?: string;
  sectionFilter?: string;
  scope?: RetrievalScope;
}

export interface RetrievalResult {
  query: QueryAnalysis;
  evidence: EvidenceBlock[];
  citations: Citation[];
  formattedContext: string;
  hasSufficientEvidence: boolean;
}
