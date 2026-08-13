import { QueryAnalyzer } from './queryAnalyzer';
import { VectorRetriever } from './vectorRetriever';
import { LexicalReranker } from './reranker';
import { ContextBuilder } from './contextBuilder';
import { VectorRepository } from '../storage/vectorRepository';
import { RetrievalResult, RetrievalScope, ConversationMessage } from './types';
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

  public async retrieveEvidence(
    userPrompt: string, 
    scope?: RetrievalScope | string, 
    history?: ConversationMessage[]
  ): Promise<RetrievalResult> {
    const selectedDocId = typeof scope === 'string' ? scope : scope?.documentIds?.[0];
    const parsedScope: RetrievalScope | undefined = typeof scope === 'object' ? scope : (selectedDocId ? { tenantId: 'tenant_default', documentIds: [selectedDocId] } : undefined);

    // 1. Query Analysis & Conversation Contextualization (Flow B §10-11)
    const query = await this.queryAnalyzer.analyze(userPrompt, selectedDocId, history, parsedScope);

    // 2. Vector Retrieval using BGE-M3 Embeddings on Vectorize Index (Top 20 candidate chunks)
    let rawMatches = await this.vectorRetriever.retrieve(query, 20);

    // Fallback: If Vectorize returns 0 matches and a document is targeted, retrieve D1 chunks directly
    if (rawMatches.length === 0 && selectedDocId && this.d1Repo) {
      try {
        const d1Chunks = await this.d1Repo.getAllChunks(selectedDocId);
        if (d1Chunks.length > 0) {
          rawMatches = d1Chunks.map(c => ({
            chunkId: c.chunkId,
            score: 0.85,
            text: c.content,
            metadata: c.metadata
          }));
        }
      } catch (err) {
        console.warn('D1 direct chunk retrieval notice:', err);
      }
    }

    // 3. Reciprocal Rank Fusion (RRF) Reranking (Select Top 8 candidate evidence blocks)
    const evidenceBlocks = this.reranker.rerank(rawMatches, query.keywords, 8);

    // 4. Structural Parent Section & Neighbor Expansion + Top Header Guarantee from D1 Database
    if (this.d1Repo && selectedDocId && evidenceBlocks.length > 0) {
      try {
        const hasHeaderChunk = evidenceBlocks.some(b => b.chunkId.endsWith('_chunk_0'));
        if (!hasHeaderChunk) {
          const headerChunks = await this.d1Repo.getNeighborChunks(selectedDocId, 0);
          if (headerChunks && headerChunks.length > 0 && headerChunks[0]) {
            const hChunk = headerChunks[0];
            const headerChunkId = `${selectedDocId}_chunk_0`;
            evidenceBlocks.unshift({
              chunkId: headerChunkId,
              documentId: selectedDocId,
              content: hChunk.content,
              score: 0.99,
              vectorScore: 0.99,
              lexicalScore: 0.99,
              rrfScore: 0.99,
              citation: {
                documentId: selectedDocId,
                documentName: 'Tài liệu',
                sectionTitle: 'Thông tin chung',
                sectionPath: ['Thông tin chung'],
                pageStart: hChunk.page_start || 1,
                pageEnd: hChunk.page_end || 1,
                chunkId: headerChunkId
              }
            });
          }
        }
      } catch (hErr) {
        console.warn('Header Chunk Fallback notice:', hErr);
      }

      for (const block of evidenceBlocks) {
        try {
          const match = rawMatches.find(m => m.chunkId === block.chunkId);
          if (match && match.metadata) {
            const chunkIndex = match.metadata.chunkIndex || 0;
            const docId = match.metadata.docId;
            const sectionTitle = match.metadata.sectionTitle;

            // First try fetching parent section content from D1
            if (sectionTitle) {
              const secContent = await this.d1Repo.getSectionContent(docId, sectionTitle);
              if (secContent && secContent.length > block.content.length && secContent.length < 3000) {
                block.content = secContent;
                continue;
              }
            }

            // Fallback to neighbor chunks
            const neighbors = await this.d1Repo.getNeighborChunks(docId, chunkIndex);
            if (neighbors && neighbors.length > 1) {
              block.content = neighbors.map(n => n.content).join('\n---\n');
            }
          }
        } catch (err) {
          console.warn('Structural Parent Context Expansion notice:', err);
        }
      }
    }

    // 5. Evidence Context Assembly & Evidence ID Formatting (Flow B §15)
    return this.contextBuilder.buildContext(query, evidenceBlocks);
  }
}


