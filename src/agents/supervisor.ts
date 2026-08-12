// Supervisor Agent (Intent Classifier & Router)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState, UserIntent } from './state';
import { LLMProviderService } from '../services/llm';

export class SupervisorAgent extends BaseAgent {
  public role: AgentRole = 'SUPERVISOR';

  constructor(llm: LLMProviderService) {
    super(llm);
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Analyzing user prompt intent and planning execution workflow...');

    const prompt = state.userPrompt;
    const lowerPrompt = prompt.toLowerCase();

    // Force RAG_ONLY if prompt mentions document terms or a docId is provided
    const docKeywords = ['file', 'tài liệu', 'hợp đồng', 'cv', 'ứng viên', 'báo cáo', 'tên', 'nội dung', 'trang', 'đoạn', 'văn bản', 'đã tải'];
    const isDocRelated = docKeywords.some(k => lowerPrompt.includes(k)) || Boolean(state.selectedDocId);

    let userIntent: UserIntent = isDocRelated ? 'RAG_ONLY' : 'HYBRID_AUDIT';
    let reasoning = isDocRelated 
      ? 'Directing to RAG Agent to search uploaded PDF documents and CVs.' 
      : 'Performing comprehensive contract and database cross-audit analysis.';

    try {
      const classification = await this.llm.generateJSON<{
        intent: UserIntent;
        reasoning: string;
      }>([
        {
          role: 'system',
          content: `You are the Supervisor Agent of FinLegal AI. Analyze the user prompt and classify intent into one of four categories:
1. "RAG_ONLY": Any questions about uploaded PDF files, contracts, CVs, resumes, candidate names, terms, clauses, or text inside documents.
2. "SQL_ONLY": Questions purely about system database metrics, sales figures, transactions, or revenue numbers in the sales database.
3. "HYBRID_AUDIT": Prompts explicitly asking to compare, audit, cross-check, or verify contract amounts vs actual database sales figures.
4. "GENERAL_CHAT": Only for basic greetings like "hi", "chào bạn", or non-document general chit-chat.

IMPORTANT: If the user asks about ANY file, CV, document, or uploaded content, you MUST classify as "RAG_ONLY".

Respond JSON format:
{
  "intent": "HYBRID_AUDIT" | "RAG_ONLY" | "SQL_ONLY" | "GENERAL_CHAT",
  "reasoning": "Brief explanation of why this intent was selected"
}`
        },
        {
          role: 'user',
          content: prompt
        }
      ]);
      
      if (classification && classification.intent) {
        userIntent = classification.intent;
        reasoning = classification.reasoning || reasoning;
      }
    } catch (err) {
      console.warn('SupervisorAgent JSON parse failed, defaulting to RAG_ONLY/HYBRID_AUDIT intent');
    }

    // Secondary override safety net
    if (isDocRelated && userIntent === 'GENERAL_CHAT') {
      userIntent = 'RAG_ONLY';
      reasoning = 'Overriding GENERAL_CHAT to RAG_ONLY because prompt asks about document or CV content.';
    }

    state.intent = userIntent;
    this.recordThought(
      state, 
      `Intent classified as [${userIntent}]: ${reasoning}`, 
      { intent: userIntent }
    );

    return state;
  }
}
