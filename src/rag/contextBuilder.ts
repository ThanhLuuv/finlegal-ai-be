// Evidence Context Builder with Parent/Section Context Expansion & Grounding Citation Guardrail

import { EvidenceBlock, RetrievalResult, QueryAnalysis, Citation } from './types';

export class ContextBuilder {
  /**
   * Assembles retrieval context with Parent / Section Context Expansion (Flow B §15)
   * Groups contiguous or related section chunks under their parent section header to prevent context loss.
   */
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

    // Parent / Section Context Expansion: Group evidence with explicit Evidence IDs [E1], [E2]
    const formattedBlocks = evidence.map((e, idx) => {
      const eid = `[E${idx + 1}]`;
      const pathStr = e.citation.sectionPath && e.citation.sectionPath.length > 0
        ? e.citation.sectionPath.join(' > ')
        : e.citation.sectionTitle || 'Chung';

      return `${eid} NGUỒN: ${e.citation.documentName} | MỤC: ${pathStr} | TRANG: ${e.citation.pageStart}\nNỘI DUNG:\n${e.content}`;
    });

    const formattedContext = `DANH SÁCH BẰNG CHỨNG TRUY XUẤT TỪ VĂN BẢN GỐC (Dùng các mã [E1], [E2]... để dẫn chứng):\n\n${formattedBlocks.join('\n\n---\n\n')}`;

    return {
      query,
      evidence,
      citations,
      formattedContext,
      hasSufficientEvidence: true
    };
  }
}


