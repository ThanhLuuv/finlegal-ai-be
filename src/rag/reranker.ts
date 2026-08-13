// Lexical Density Reranker (Vector Search + Keyword Boost Reranking)

import { RawRetrievedMatch } from './vectorRetriever';
import { EvidenceBlock } from './types';

export class LexicalReranker {
  /**
   * Reranks vector candidate matches using normalized hybrid scoring:
   * finalScore = 0.8 * vectorScore + 0.2 * normalizedLexicalScore
   */
  public rerank(matches: RawRetrievedMatch[], keywords: string[], topK = 5): EvidenceBlock[] {
    if (matches.length === 0) return [];

    const totalKeywords = Math.max(1, keywords.length);

    const reranked = matches.map(match => {
      const lowerText = match.text.toLowerCase();
      const secTitle = (match.metadata.sectionTitle || '').toLowerCase();
      let matchedCount = 0;

      for (const kw of keywords) {
        if (lowerText.includes(kw) || secTitle.includes(kw)) {
          matchedCount++;
        }
      }

      // Normalized lexical ratio between 0.0 and 1.0
      const lexicalScore = Math.min(1.0, matchedCount / totalKeywords);

      // Weighted combination score
      const finalScore = 0.8 * match.score + 0.2 * lexicalScore;

      return {
        chunkId: match.chunkId,
        documentId: match.metadata.docId,
        content: match.text,
        score: finalScore,
        citation: {
          documentId: match.metadata.docId,
          documentName: match.metadata.fileName,
          sectionTitle: match.metadata.sectionTitle,
          sectionPath: match.metadata.sectionPath || [],
          pageStart: match.metadata.pageStart || 1,
          pageEnd: match.metadata.pageEnd || 1,
          chunkId: match.chunkId
        }
      };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }
}
