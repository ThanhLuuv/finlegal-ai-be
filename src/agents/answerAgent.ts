// Zero-Hallucination Answer Synthesizer Agent with Structured Citations

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { RetrievalResult } from '../rag/types';

export class AnswerAgent extends BaseAgent {
  public role: AgentRole = 'AUDITOR';

  constructor(llm: LLMProviderService) {
    super(llm);
  }

  public async generateAnswer(state: MultiAgentState, ragResult?: RetrievalResult): Promise<string> {
    this.recordThought(state, 'Generating zero-hallucination answer based on evidence and citations...');

    if (ragResult && !ragResult.hasSufficientEvidence) {
      return `⚠️ **Thông báo hệ thống FinLegal AI**: Tài liệu hiện tại không chứa đủ thông tin để trả lời câu hỏi của bạn. Vui lòng cung cấp thêm thông tin hoặc kiểm tra lại file tài liệu đã tải lên!`;
    }

    const contextStr = ragResult ? ragResult.formattedContext : (state.ragContext || 'Không có dữ liệu RAG.');
    const sqlStr = state.sqlData ? JSON.stringify(state.sqlData, null, 2) : 'Không có dữ liệu SQL D1.';

    const systemPrompt = `You are FinLegal AI's Senior Evidence Synthesizer & Auditor.
You MUST follow these CRITICAL ENTERPRISE RULES:
1. Respond 100% in Vietnamese, professionally and clearly.
2. ZERO-HALLUCINATION GUARDRAIL: Base your answer EXCLUSIVELY on the provided Evidence Blocks and SQL Data.
3. If the provided evidence is insufficient to answer the prompt, explicitly state that the documents do not contain enough information instead of guessing or fabricating facts.
4. Always cite evidence locations when answering (e.g. "Theo [Mục/Điều ... | Trang ...]...").`;

    const userPrompt = `USER PROMPT:\n${state.userPrompt}\n\nRETRIEVED EVIDENCE BLOCKS:\n${contextStr}\n\nSQL D1 DATA:\n${sqlStr}`;

    const answer = await this.llm.generateText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    state.finalAnswer = answer;
    return answer;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    await this.generateAnswer(state);
    return state;
  }
}
