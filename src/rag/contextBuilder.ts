// Evidence Context Builder with Zero-Hallucination Guardrail

import { EvidenceBlock, RetrievalResult, QueryAnalysis, Citation } from './types';

export class ContextBuilder {
  public buildContext(query: QueryAnalysis, evidence: EvidenceBlock[]): RetrievalResult {
    const hasEvidence = evidence.length > 0 && evidence.some(e => e.score > 0.05);

    if (!hasEvidence) {
      return {
        query,
        evidence: [],
        citations: [],
        formattedContext: 'KHÔNG CÓ BẰNG CHỨNG TÌM THẤY TRONG TÀI LIỆU.',
        hasSufficientEvidence: false
      };
    }

    const citations: Citation[] = evidence.map(e => e.citation);

    const formattedBlocks = evidence.map((e, idx) => {
      const pathStr = e.citation.sectionPath && e.citation.sectionPath.length > 0
        ? e.citation.sectionPath.join(' > ')
        : e.citation.sectionTitle || 'Chung';

      return `--- [DẪN CHỨNG ${idx + 1} | File: ${e.citation.documentName} | Mục: ${pathStr} | Trang: ${e.citation.pageStart}] ---\n${e.content}`;
    });

    const formattedContext = `DANH SÁCH BẰNG CHỨNG TRUY XUẤT TỪ TÀI LIỆU NỘI BỘ:\n\n${formattedBlocks.join('\n\n')}`;

    return {
      query,
      evidence,
      citations,
      formattedContext,
      hasSufficientEvidence: true
    };
  }
}
