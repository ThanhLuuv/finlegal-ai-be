// Lexical Density Reranker (Vector Search + Keyword Boost Reranking)

import { RawRetrievedMatch } from './vectorRetriever';
import { EvidenceBlock } from './types';

export class LexicalReranker {
  public rerank(matches: RawRetrievedMatch[], keywords: string[]): EvidenceBlock[] {
    const reranked = matches.map(match => {
      const lowerText = match.text.toLowerCase();
      let keywordBoost = 0;

      for (const kw of keywords) {
        if (lowerText.includes(kw)) {
          keywordBoost += 0.12;
        }
      }

      // Additional section title boost if keyword hits section title
      const secTitle = (match.metadata.sectionTitle || '').toLowerCase();
      for (const kw of keywords) {
        if (secTitle.includes(kw)) {
          keywordBoost += 0.15;
        }
      }

      const finalScore = Math.min(1.0, match.score + keywordBoost);

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
    return reranked;
  }
}
