// RAG Engine Types, Citations & Evidence Models

export interface Citation {
  documentId: string;
  documentName: string;
  sectionTitle?: string;
  sectionPath?: string[];
  pageStart?: number;
  pageEnd?: number;
  chunkId: string;
}

export interface EvidenceBlock {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  citation: Citation;
}

export interface QueryAnalysis {
  originalQuery: string;
  rewrittenQuery: string;
  keywords: string[];
  targetDocId?: string;
  documentTypeFilter?: string;
  sectionFilter?: string;
}

export interface RetrievalResult {
  query: QueryAnalysis;
  evidence: EvidenceBlock[];
  citations: Citation[];
  formattedContext: string;
  hasSufficientEvidence: boolean;
}
