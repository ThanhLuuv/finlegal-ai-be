// RAG Orchestration Service (Flow B §10-18)

import { QueryAnalyzer } from './queryAnalyzer';
import { VectorRetriever } from './vectorRetriever';
import { LexicalReranker } from './reranker';
import { ContextBuilder } from './contextBuilder';
import { VectorRepository } from '../storage/vectorRepository';
import { RetrievalResult } from './types';
import { LLMProviderService } from '../services/llm';

import { D1DocumentRepository } from '../storage/d1DocumentRepository';

export class RagService {
  private queryAnalyzer: QueryAnalyzer;
  private vectorRetriever: VectorRetriever;
  private reranker: LexicalReranker;
  private contextBuilder: ContextBuilder;
  private d1Repo?: D1DocumentRepository;

  constructor(vectorRepo: VectorRepository, llm?: LLMProviderService, d1Repo?: D1DocumentRepository) {
    this.queryAnalyzer = new QueryAnalyzer(llm);
    this.vectorRetriever = new VectorRetriever(vectorRepo);
    this.reranker = new LexicalReranker();
    this.contextBuilder = new ContextBuilder();
    this.d1Repo = d1Repo;
  }

  public async retrieveEvidence(userPrompt: string, selectedDocId?: string): Promise<RetrievalResult> {
    // 1. Query Analysis & Conditional Query Rewrite (Flow B §10-11)
    const query = await this.queryAnalyzer.analyze(userPrompt, selectedDocId);

    // 2. Vector Retrieval using BGE-M3 Embeddings on Vectorize Index (Flow B §12-13: Top 20 chunks)
    const rawMatches = await this.vectorRetriever.retrieve(query, 20);

    // 3. Normalized Lexical Reranking (Flow B §14 & §18: Select Top 5-8 candidate chunks)
    const evidenceBlocks = this.reranker.rerank(rawMatches, query.keywords, 5);

    // 4. Real Parent / Neighbor Chunk Expansion from D1 Database
    if (this.d1Repo && evidenceBlocks.length > 0) {
      for (const block of evidenceBlocks) {
        try {
          const match = rawMatches.find(m => m.chunkId === block.chunkId);
          if (match && match.metadata) {
            const chunkIndex = match.metadata.chunkIndex || 0;
            const docId = match.metadata.docId;
            const neighbors = await this.d1Repo.getNeighborChunks(docId, chunkIndex);

            if (neighbors && neighbors.length > 1) {
              // Expand content to include neighbor chunk context
              block.content = neighbors.map(n => n.content).join('\n---\n');
            }
          }
        } catch (err) {
          console.warn('Real Parent Context Expansion notice:', err);
        }
      }
    }

    // 5. Evidence Context Assembly & Guardrail (Flow B §15)
    return this.contextBuilder.buildContext(query, evidenceBlocks);
  }
}


