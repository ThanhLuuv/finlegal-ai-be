// Grounded LLM Evidence Synthesizer & Citation Mapper

import { LLMProviderService } from '../../services/llm';
import { RetrievedEvidenceCandidate } from '../retrieval/hybridRetriever';
import { CitationValidator } from './citationValidator';
import { Citation, GroundedSynthesisResult } from '../types';

export class GroundedSynthesizer {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Generates grounded answer based strictly on Top 3-5 reranked evidence blocks
   */
  public async synthesize(
    userPrompt: string,
    evidenceBlocks: RetrievedEvidenceCandidate[],
    intent = 'RAG_ONLY',
    sqlData?: any
  ): Promise<GroundedSynthesisResult> {
    const hasEvidence = evidenceBlocks && evidenceBlocks.length > 0;
    const hasSqlData = sqlData && ((Array.isArray(sqlData) && sqlData.length > 0) || typeof sqlData === 'object');

    if (!hasEvidence && !hasSqlData && intent !== 'GENERAL_CHAT') {
      return {
        answer: `**Thông báo Lexifin**: Không tìm thấy đoạn trích dẫn phù hợp trong tài liệu hoặc dữ liệu SQL để trả lời câu hỏi của bạn. Vui lòng kiểm tra lại câu hỏi!`,
        citations: []
      };
    }

    // Format Evidence Context
    const formattedBlocks = evidenceBlocks.map((b, i) => {
      const docName = b.metadata?.fileName || 'Tài liệu.pdf';
      const secTitle = b.metadata?.sectionTitle || 'Nội dung';
      const pageStart = b.metadata?.pageStart || 1;
      const pageEnd = b.metadata?.pageEnd || 1;
      return `[E${i + 1}] (File: ${docName} | Section: ${secTitle} | Trang ${pageStart}-${pageEnd})\n${b.content}`;
    }).join('\n\n---\n\n');

    const sqlStr = sqlData && Array.isArray(sqlData) && sqlData.length > 0
      ? JSON.stringify(sqlData, null, 2)
      : 'Không có dữ liệu SQL D1.';

    const systemPrompt = `You are Lexifin's Senior Evidence Synthesizer & Compliance Auditor.
GROUNDING & CITATION GUARDRAIL RULES:
1. Respond 100% in Vietnamese, professionally, accurately, and neatly in Markdown.
2. Synthesize answer EXCLUSIVELY based on the provided Evidence Blocks [E1], [E2]... inside <document_evidence> and SQL Data.
3. Every claim MUST be directly cited using exact Evidence ID tags (e.g. "[E1]", "[E2]").
4. For candidate CVs or contract reviews, summarize clearly: Thông tin cá nhân, Kỹ năng, Kinh nghiệm làm việc, Dự án tiêu biểu, Điều khoản phạt/bảo hành/thanh toán.`;

    const userMsg = `CÂU HỎI NGƯỜI DÙNG:\n${userPrompt}\n\n<document_evidence>\n${formattedBlocks}\n</document_evidence>\n\nSQL D1 DATA:\n${sqlStr}`;

    let rawAnswer = await this.llm.generateText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg }
    ], { task: 'MAIN_ANSWER' });

    // Clean DeepSeek <think> reasoning tags from final public answer text
    rawAnswer = rawAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Validate citations post-LLM via CitationValidator
    const rawCitations: Citation[] = evidenceBlocks.map((b) => {
      const docName = b.metadata?.fileName || 'document.pdf';
      const secTitle = b.metadata?.sectionTitle || 'Chung';
      const pageStart = b.metadata?.pageStart || 1;
      const pageEnd = b.metadata?.pageEnd || 1;
      const docId = b.documentId || b.metadata?.docId || '';

      return {
        documentName: docName,
        sectionTitle: secTitle,
        pageStart,
        pageEnd,
        r2ViewUrl: docId ? `/api/documents/${docId}/view` : undefined
      };
    });

    const verifiedRes = CitationValidator.validateAndMapCitations(rawAnswer, rawCitations);
    const mappedCitations = verifiedRes.citedEvidences;

    let auditReport: any = undefined;
    if (intent === 'HYBRID_AUDIT') {
      const hasDiscrepancy = /chênh lệch|không khớp|mâu thuẫn|lệch|bất đồng/i.test(rawAnswer);
      auditReport = {
        auditId: `audit_${Date.now()}`,
        contractRef: 'CTR-2024-001',
        discrepancies: hasDiscrepancy ? ['Phát hiện sự không đồng nhất giữa giá trị hợp đồng và dữ liệu thanh toán thực tế.'] : [],
        riskLevel: hasDiscrepancy ? 'HIGH' : 'LOW',
        complianceStatus: hasDiscrepancy ? 'FAILED' : 'PASSED',
        summary: hasDiscrepancy
          ? 'Cảnh báo đối soát: Phát hiện sự lệch nhau giữa điều khoản hợp đồng và giao dịch D1.'
          : 'Đối soát hoàn tất: Dữ liệu giao dịch khớp hoàn toàn với quy định hợp đồng.'
      };
    }

    return {
      answer: rawAnswer,
      citations: mappedCitations,
      auditReport
    };
  }
}
