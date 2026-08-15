// Stage 2 Hybrid Retrieval Engine (Dense Search + Sparse Keyword Search -> RRF Merge & Deduplicate)

import { VectorRepository } from '../../storage/vectorRepository';
import { D1DocumentRepository } from '../../storage/d1DocumentRepository';

export interface RetrievedEvidenceCandidate {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  denseScore: number;
  sparseScore: number;
  rrfScore: number;
  metadata: any;
}

export class HybridRetriever {
  private vectorRepo: VectorRepository;
  private d1Repo: D1DocumentRepository;

  constructor(vectorRepo: VectorRepository, d1Repo: D1DocumentRepository) {
    this.vectorRepo = vectorRepo;
    this.d1Repo = d1Repo;
  }

  /**
   * Executes Stage 2 Hybrid Retrieval:
   * 1. Dense Vector Search on Cloudflare Vectorize (Top 20-30 candidates)
   * 2. Sparse / Keyword Search on D1 SQLite (Top keyword matches)
   * 3. Reciprocal Rank Fusion (RRF) Merge & Deduplication
   */
  public async retrieveCandidates(
    queryText: string,
    keywords: string[],
    targetDocId?: string,
    topDense = 25,
    topSparse = 20
  ): Promise<RetrievedEvidenceCandidate[]> {
    // 1. Dense Search (Vectorize Top 25)
    const denseMatches = await this.vectorRepo.queryVectorMatches(queryText, topDense, targetDocId);

    // 2. Sparse Keyword Search (D1 SQLite LIKE Top 20)
    let sparseMatches: Array<{ chunkId: string; content: string; metadata: any }> = [];
    if (keywords.length > 0 && targetDocId) {
      sparseMatches = await this.d1Repo.searchChunksByKeywords(targetDocId, keywords, topSparse);
    } else if (targetDocId && denseMatches.length === 0) {
      sparseMatches = await this.d1Repo.getAllChunks(targetDocId);
    }

    // 3. Reciprocal Rank Fusion (RRF) Map
    const kRRF = 60;
    const rrfMap = new Map<string, {
      candidate: RetrievedEvidenceCandidate;
      denseRank?: number;
      sparseRank?: number;
    }>();

    // Map Dense Matches
    denseMatches.forEach((m, idx) => {
      const rank = idx + 1;
      rrfMap.set(m.chunkId, {
        candidate: {
          chunkId: m.chunkId,
          documentId: targetDocId || m.metadata?.docId || 'unknown_doc',
          content: m.text,
          score: m.score,
          denseScore: m.score,
          sparseScore: 0,
          rrfScore: 0,
          metadata: m.metadata || {}
        },
        denseRank: rank
      });
    });

    // Map Sparse Matches
    sparseMatches.forEach((m, idx) => {
      const rank = idx + 1;
      const existing = rrfMap.get(m.chunkId);
      if (existing) {
        existing.sparseRank = rank;
        existing.candidate.sparseScore = 0.8;
      } else {
        rrfMap.set(m.chunkId, {
          candidate: {
            chunkId: m.chunkId,
            documentId: targetDocId || m.metadata?.docId || 'unknown_doc',
            content: m.content,
            score: 0.5,
            denseScore: 0,
            sparseScore: 0.8,
            rrfScore: 0,
            metadata: m.metadata || {}
          },
          sparseRank: rank
        });
      }
    });

    // Compute RRF Scores
    const mergedCandidates: RetrievedEvidenceCandidate[] = [];

    rrfMap.forEach(item => {
      let rrfScore = 0;
      if (item.denseRank !== undefined) {
        rrfScore += 1 / (kRRF + item.denseRank);
      }
      if (item.sparseRank !== undefined) {
        rrfScore += 1 / (kRRF + item.sparseRank);
      }

      item.candidate.rrfScore = rrfScore;
      item.candidate.score = rrfScore;
      mergedCandidates.push(item.candidate);
    });

    // Sort by RRF Score descending
    return mergedCandidates.sort((a, b) => b.rrfScore - a.rrfScore);
  }
}
