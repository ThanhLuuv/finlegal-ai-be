// RAG Orchestration Service

import { QueryAnalyzer } from './queryAnalyzer';
import { VectorRetriever } from './vectorRetriever';
import { LexicalReranker } from './reranker';
import { ContextBuilder } from './contextBuilder';
import { VectorRepository } from '../storage/vectorRepository';
import { RetrievalResult } from './types';

export class RagService {
  private queryAnalyzer: QueryAnalyzer;
  private vectorRetriever: VectorRetriever;
  private reranker: LexicalReranker;
  private contextBuilder: ContextBuilder;

  constructor(vectorRepo: VectorRepository) {
    this.queryAnalyzer = new QueryAnalyzer();
    this.vectorRetriever = new VectorRetriever(vectorRepo);
    this.reranker = new LexicalReranker();
    this.contextBuilder = new ContextBuilder();
  }

  public async retrieveEvidence(userPrompt: string, selectedDocId?: string): Promise<RetrievalResult> {
    // 1. Query Analysis
    const query = this.queryAnalyzer.analyze(userPrompt, selectedDocId);

    // 2. Vector Retrieval with Metadata Filtering
    const rawMatches = await this.vectorRetriever.retrieve(query, 8);

    // 3. Lexical Keyword Density Reranking
    const evidenceBlocks = this.reranker.rerank(rawMatches, query.keywords);

    // 4. Evidence Context Assembly & Guardrail
    return this.contextBuilder.buildContext(query, evidenceBlocks);
  }
}
