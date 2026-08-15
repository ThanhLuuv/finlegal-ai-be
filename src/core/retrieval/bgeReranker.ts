// Stage 2 Reranking Engine (Selects Top 3-5 Highest Quality Candidates using BGE-Reranker)

import { RetrievedEvidenceCandidate } from './hybridRetriever';

export class BgeReranker {
  private ai?: Ai;

  constructor(ai?: Ai) {
    this.ai = ai;
  }

  /**
   * Reranks fused candidate pool down to Top 3–5 highest quality evidence blocks
   */
  public async rerank(
    queryText: string,
    candidates: RetrievedEvidenceCandidate[],
    topK = 5
  ): Promise<RetrievedEvidenceCandidate[]> {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length <= topK) return candidates;

    // Try Workers AI BGE Reranker models catalog (@cf/baai/bge-reranker-large, @cf/baai/bge-reranker-base)
    if (this.ai) {
      const rerankModels = [
        '@cf/baai/bge-reranker-large',
        '@cf/baai/bge-reranker-base'
      ];
      const inputTexts = candidates.map(c => c.content);

      for (const rModel of rerankModels) {
        try {
          const rerankResult: any = await (this.ai as any).run(rModel as any, {
            query: queryText,
            documents: inputTexts,
            top_k: topK
          });

          if (rerankResult && Array.isArray(rerankResult.results)) {
            const reranked: RetrievedEvidenceCandidate[] = [];
            for (const item of (rerankResult.results as any[])) {
              const index = item.index;
              if (candidates[index]) {
                reranked.push({
                  ...candidates[index],
                  score: item.score || candidates[index].score
                });
              }
            }
            if (reranked.length > 0) return reranked;
          }
        } catch (err) {
          console.warn(`Workers AI BGE Reranker model ${rModel} notice:`, err);
        }
      }
    }

    // High-performance scoring fallback based on exact keyword density & length weighting
    const queryTokens = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    const scored = candidates.map(c => {
      const lowerContent = c.content.toLowerCase();
      let matchCount = 0;
      for (const tok of queryTokens) {
        if (lowerContent.includes(tok)) matchCount++;
      }
      const lexicalDensity = matchCount / Math.max(1, queryTokens.length);
      const combinedScore = (c.rrfScore * 0.7) + (lexicalDensity * 0.3);

      return {
        ...c,
        score: combinedScore
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
