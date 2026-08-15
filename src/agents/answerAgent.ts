// Zero-Hallucination Answer Synthesizer Agent with Structured Citations & Multi-Section Evidence Merging

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { RetrievalResult } from '../rag/types';
import { CitationValidator } from '../rag/citationValidator';

export class AnswerAgent extends BaseAgent {
  public role: AgentRole = 'AUDITOR';

  constructor(llm: LLMProviderService) {
    super(llm);
  }

  public async generateAnswer(state: MultiAgentState, ragResult?: RetrievalResult): Promise<string> {
    this.recordThought(state, 'Executing Grounding & Citation Validation based on retrieved evidence blocks...');

    if (ragResult && !ragResult.hasSufficientEvidence) {
      return `⚠️ **Thông báo hệ thống FinLegal AI**: Tài liệu hiện tại không chứa đủ thông tin để trả lời câu hỏi của bạn. Vui lòng cung cấp thêm thông tin hoặc chọn đúng tập tin văn bản cần tra cứu!`;
    }

    const rawContext = ragResult ? ragResult.formattedContext : state.ragContext;
    const contextStr = typeof rawContext === 'string' ? rawContext : JSON.stringify(rawContext || 'Không có dữ liệu RAG.');
    const sqlData = state.sqlResult || state.sqlData;
    const sqlStr = sqlData && Array.isArray(sqlData) && sqlData.length > 0 ? JSON.stringify(sqlData, null, 2) : 'Không có dữ liệu SQL D1.';

    console.log('4 FINAL LLM CONTEXT:\n', contextStr.slice(0, 2000));

    const systemPrompt = `You are FinLegal AI's Senior Evidence Synthesizer & Auditor.
You MUST follow these GROUNDING & CITATION GUARDRAIL RULES:
1. Respond 100% in Vietnamese, professionally, accurately, thoroughly, and neatly in Markdown format.
2. GROUNDING GUARDRAIL: Synthesize your answer EXCLUSIVELY based on the provided Evidence Blocks [E1], [E2]... and SQL Data.
3. CRITICAL EVIDENCE INSPECTION RULE: Read ALL provided evidence blocks [E1], [E2], ... before forming your response. Do NOT conclude that any section or information (such as Work Experience / Kinh nghiệm làm việc, Education / Học vấn, Selected Projects / Dự án tiêu biểu, Core Skills / Kỹ năng, Profile / Thông tin cá nhân) is missing until EVERY provided evidence block has been thoroughly inspected.
4. SECTION MERGING RULE: Evidence blocks contain information extracted across pages/sections. Systematically merge and reassemble information under appropriate headers.
5. DOCUMENT REVIEW & CANDIDATE PROFILE RULE: For document reviews or candidate overviews, systematically organize and summarize:
   - Thông tin cá nhân & Liên hệ (Tên ứng viên, Email, SĐT, Địa chỉ, Profile)
   - Kỹ năng cốt lõi (Core Skills)
   - Kinh nghiệm làm việc (Work Experience - vị trí, thời gian, công ty, mô tả công việc)
   - Dự án tiêu biểu (Selected Projects - tên dự án, công nghệ, vai trò)
   - Học vấn & Ngoại ngữ (Education & Language)
6. INSUFFICIENT EVIDENCE RULE: Only state that information is "không được cung cấp" or "missing" if it does NOT appear in ANY of the provided evidence blocks [E1]...[E8].
7. STRICT EVIDENCE ID CITATION RULE: Every claim or section mentioned MUST be directly cited using the exact Evidence ID tag (e.g., "[E1]", "[E2]").`;

    const userPrompt = `USER PROMPT:\n${state.userPrompt}\n\nRETRIEVED EVIDENCE BLOCKS:\n${contextStr}\n\nSQL D1 DATA:\n${sqlStr}`;

    const answer = await this.llm.generateText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { task: 'MAIN_ANSWER' });

    // Post-LLM Grounding & Evidence ID Validation Step
    this.recordThought(state, 'Running Post-LLM Evidence ID & Grounding Audit to verify citations...');

    const evidencePool = ragResult?.evidence || [];
    const validationRes = CitationValidator.validateAndMapCitations(answer, evidencePool);

    if (validationRes.hasInvalidCitations) {
      this.recordThought(state, `Notice: Invalid evidence IDs detected in LLM response. Cleaned up cited sources list.`, { warnings: validationRes.warnings });
    }

    // Attach validated citations to state
    state.citations = validationRes.citedEvidences.map(c => ({
      documentName: c.documentName || 'document.pdf',
      sectionTitle: c.sectionTitle || 'Chung',
      pageStart: c.pageStart || 1,
      pageEnd: c.pageEnd || 1
    }));

    state.finalAnswer = validationRes.answer;
    return validationRes.answer;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    await this.generateAnswer(state);
    return state;
  }
}
