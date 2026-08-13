// Lexical Density Reranker (Vector Search + Keyword Boost Reranking)

import { RawRetrievedMatch } from './vectorRetriever';
import { EvidenceBlock } from './types';

export class LexicalReranker {
  /**
   * Merges Dense Vector Search and Lexical Keyword Search candidates using Reciprocal Rank Fusion (RRF):
   * score(d) = 1 / (60 + rank_vector(d)) + 1 / (60 + rank_lexical(d))
   */
  public rerank(matches: RawRetrievedMatch[], keywords: string[], topK = 5): EvidenceBlock[] {
    if (matches.length === 0) return [];

    const kConstant = 60;
    const totalKeywords = Math.max(1, keywords.length);

    // 1. Vector Rank Map (sorted by vector similarity score)
    const vectorSorted = [...matches].sort((a, b) => b.score - a.score);
    const vectorRankMap = new Map<string, number>();
    vectorSorted.forEach((m, idx) => vectorRankMap.set(m.chunkId, idx + 1));

    // 2. Lexical Rank Map (sorted by keyword hit density)
    const lexicalScored = matches.map(match => {
      const lowerText = match.text.toLowerCase();
      const secTitle = (match.metadata.sectionTitle || '').toLowerCase();
      let matchedCount = 0;

      for (const kw of keywords) {
        if (lowerText.includes(kw) || secTitle.includes(kw)) {
          matchedCount++;
        }
      }

      const lexicalRatio = Math.min(1.0, matchedCount / totalKeywords);
      return { match, lexicalRatio };
    });

    lexicalScored.sort((a, b) => b.lexicalRatio - a.lexicalRatio);
    const lexicalRankMap = new Map<string, number>();
    lexicalScored.forEach((item, idx) => lexicalRankMap.set(item.match.chunkId, idx + 1));

    // 3. Calculate Reciprocal Rank Fusion (RRF) Scores
    const reranked: EvidenceBlock[] = matches.map(match => {
      const vRank = vectorRankMap.get(match.chunkId) || matches.length;
      const lRank = lexicalRankMap.get(match.chunkId) || matches.length;

      const rrfScore = (1.0 / (kConstant + vRank)) + (1.0 / (kConstant + lRank));

      return {
        chunkId: match.chunkId,
        documentId: match.metadata.docId,
        content: match.text,
        score: rrfScore,
        vectorScore: match.score,
        lexicalScore: (lexicalScored.find(ls => ls.match.chunkId === match.chunkId)?.lexicalRatio) || 0,
        rrfScore,
        citation: {
          documentId: match.metadata.docId,
          documentName: match.metadata.fileName,
          sectionTitle: match.metadata.sectionTitle,
          sectionPath: match.metadata.sectionPath || [],
          pageStart: match.metadata.pageStart || 1,
          pageEnd: match.metadata.pageEnd || 1,
          chunkId: match.chunkId,
          sourceLocation: match.metadata.sourceLocation
        }
      };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }
}
