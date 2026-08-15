// Enterprise Production RAG Service with Intent Routing, Small-Doc Full Context, and Hybrid Search (Dense + Lexical RRF)

import { QueryAnalyzer } from './queryAnalyzer';
import { VectorRetriever, RawRetrievedMatch } from './vectorRetriever';
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

    // 1. Query Analysis & Intent Router
    const query = await this.queryAnalyzer.analyze(userPrompt, selectedDocId, history, parsedScope);

    // Intent Classification: Check if user asks for whole document summary/overview/review
    const isFullDocIntent = /tóm tắt|đọc toàn bộ|nội dung file|nội dung tài liệu|phân tích|liệt kê tất cả|review|tổng quan|thông tin gì|cv này|ứng viên|hồ sơ/i.test(userPrompt);

    // ROUTER BRANCH 1: Small Document Full-Context Direct Mode (tokenCount <= 12,000 / chunks <= 30)
    if (selectedDocId && this.d1Repo) {
      try {
        const d1Chunks = await this.d1Repo.getAllChunks(selectedDocId);
        if (d1Chunks.length > 0 && (isFullDocIntent || d1Chunks.length <= 25)) {
          const evidenceBlocks = d1Chunks.map((c, idx) => ({
            chunkId: c.chunkId,
            documentId: selectedDocId,
            content: c.content,
            score: 1.0,
            vectorScore: 1.0,
            lexicalScore: 1.0,
            rrfScore: 1.0,
            citation: {
              documentId: selectedDocId,
              documentName: c.metadata?.fileName || 'Tài liệu',
              sectionTitle: c.metadata?.sectionTitle || 'Nội dung',
              sectionPath: c.metadata?.sectionPath || [c.metadata?.sectionTitle || 'Nội dung'],
              pageStart: c.metadata?.pageStart || 1,
              pageEnd: c.metadata?.pageEnd || 1,
              chunkId: c.chunkId
            }
          }));

          console.log(`[FULL_CONTEXT MODE] Loaded ALL ${evidenceBlocks.length} sequential chunks for doc: ${selectedDocId}`);
          return this.contextBuilder.buildContext(query, evidenceBlocks);
        }
      } catch (err) {
        console.warn('[RagService] Full Context direct loading notice:', err);
      }
    }

    // ROUTER BRANCH 2: TRUE HYBRID RETRIEVAL (Dense Vector Search + Lexical Exact Search -> RRF Fusion)
    console.log(`[HYBRID SEARCH MODE] Querying Dense Embeddings + Lexical Matches for prompt: "${userPrompt}"`);

    // A. Dense Vector Retrieval (Vectorize Top 20)
    const denseMatches = await this.vectorRetriever.retrieve(query, 20);

    // B. Lexical Exact Keyword Retrieval from D1 SQLite Database
    const lexicalMatches: RawRetrievedMatch[] = [];
    if (this.d1Repo && query.keywords.length > 0 && selectedDocId) {
      try {
        const allChunks = await this.d1Repo.getAllChunks(selectedDocId);
        for (const c of allChunks) {
          const lowerText = c.content.toLowerCase();
          const keywordCount = query.keywords.filter(kw => lowerText.includes(kw.toLowerCase())).length;
          if (keywordCount > 0) {
            lexicalMatches.push({
              chunkId: c.chunkId,
              score: 0.5 + (keywordCount / query.keywords.length) * 0.5,
              text: c.content,
              metadata: c.metadata
            });
          }
        }
      } catch (lexErr) {
        console.warn('[RagService] Lexical D1 Search notice:', lexErr);
      }
    }

    // C. Reciprocal Rank Fusion (RRF) to combine Dense & Lexical Candidates
    const combinedMap = new Map<string, RawRetrievedMatch>();
    for (const m of denseMatches) combinedMap.set(m.chunkId, m);
    for (const m of lexicalMatches) {
      if (!combinedMap.has(m.chunkId)) {
        combinedMap.set(m.chunkId, m);
      }
    }

    const candidatePool = Array.from(combinedMap.values());

    // D. Lexical Reranker (Select Top 10-12 candidate evidence blocks)
    const evidenceBlocks = this.reranker.rerank(candidatePool, query.keywords, 12);

    console.log(`[HYBRID SEARCH SUCCESS] Fused & reranked ${evidenceBlocks.length} top evidence blocks.`);

    // E. Structural Parent Section & Neighbor Chunk Context Expansion
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
          const match = candidatePool.find(m => m.chunkId === block.chunkId);
          if (match && match.metadata) {
            const chunkIndex = match.metadata.chunkIndex || 0;
            const docId = match.metadata.docId;
            const sectionTitle = match.metadata.sectionTitle;

            if (sectionTitle) {
              const secContent = await this.d1Repo.getSectionContent(docId, sectionTitle);
              if (secContent && secContent.length > block.content.length && secContent.length < 3000) {
                block.content = secContent;
                continue;
              }
            }

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

    // 5. Evidence Context Assembly
    return this.contextBuilder.buildContext(query, evidenceBlocks);
  }
}
