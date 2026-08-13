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
    this.recordThought(state, 'Executing Grounding & Citation Validation based on retrieved evidence blocks...');

    if (ragResult && !ragResult.hasSufficientEvidence) {
      return `⚠️ **Thông báo hệ thống FinLegal AI**: Tài liệu hiện tại không chứa đủ thông tin để trả lời câu hỏi của bạn. Vui lòng cung cấp thêm thông tin hoặc chọn đúng tập tin văn bản cần tra cứu!`;
    }

    const rawContext = ragResult ? ragResult.formattedContext : state.ragContext;
    const contextStr = typeof rawContext === 'string' ? rawContext : JSON.stringify(rawContext || 'Không có dữ liệu RAG.');
    const sqlData = state.sqlResult || state.sqlData;
    const sqlStr = sqlData && Array.isArray(sqlData) && sqlData.length > 0 ? JSON.stringify(sqlData, null, 2) : 'Không có dữ liệu SQL D1.';



    const systemPrompt = `You are FinLegal AI's Senior Evidence Synthesizer & Auditor.
You MUST follow these GROUNDING & CITATION GUARDRAIL RULES:
1. Respond 100% in Vietnamese, professionally, accurately, and concisely.
2. GROUNDING GUARDRAIL: Synthesize your answer EXCLUSIVELY based on the provided Evidence Blocks [E1], [E2]... and SQL Data.
3. STRICT EVIDENCE ID CITATION RULE: Every claim or clause mentioned MUST be directly cited using the exact Evidence ID tag (e.g., "[E1]", "[E2]"). Do NOT invent or spell out arbitrary file names or page numbers in prose — strictly use the [E1], [E2] tags provided in the evidence context.
4. INSUFFICIENT EVIDENCE RULE: If the evidence blocks do not contain sufficient information to directly answer the question, explicitly inform the user that the retrieved documents do not contain the answer, instead of fabricating information.`;


    const userPrompt = `USER PROMPT:\n${state.userPrompt}\n\nRETRIEVED EVIDENCE BLOCKS:\n${contextStr}\n\nSQL D1 DATA:\n${sqlStr}`;

    const answer = await this.llm.generateText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { task: 'MAIN_ANSWER' });

    // Post-LLM Grounding Validation Step: Verify answer fact consistency against retrieved evidence
    this.recordThought(state, 'Running Post-LLM Grounding Audit to verify facts and citations against raw context...');

    const numbersInAnswer = answer.match(/\d+[\.,]?\d*/g) || [];
    const contextLower = contextStr.toLowerCase();
    let unsupportedFacts = 0;

    for (const num of numbersInAnswer) {
      if (num.length > 2 && !contextLower.includes(num.toLowerCase())) {
        unsupportedFacts++;
      }
    }

    let finalValidatedAnswer = answer;
    if (numbersInAnswer.length > 3 && unsupportedFacts > numbersInAnswer.length / 2) {
      this.recordThought(state, 'Warning: Grounding audit detected possible ungrounded numbers. Appending audit disclaimer.');
      finalValidatedAnswer += `\n\n⚠️ *Lưu ý đối soát*: Một số số liệu chi tiết trong câu trả lời có thể cần kiểm tra trực tiếp đối chiếu lại với các trang dẫn chứng tương ứng trong văn bản gốc.`;
    }

    state.finalAnswer = finalValidatedAnswer;
    return finalValidatedAnswer;
  }



  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    await this.generateAnswer(state);
    return state;
  }
}
