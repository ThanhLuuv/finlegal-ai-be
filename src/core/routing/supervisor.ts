// Dynamic AI Supervisor Router - Powered by AI Semantic Intent Understanding

import { LLMProviderService } from '../../services/llm';
import { MultiAgentState, UserIntent } from '../types';

export class SupervisorRouter {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Dynamically analyzes user prompt semantically with AI to route intent
   */
  public async routeIntent(state: MultiAgentState): Promise<MultiAgentState> {
    const prompt = (state.userPrompt || '').trim();
    const hasSelectedDoc = Boolean(state.selectedDocId);

    // Fast check: If user selected a document in UI -> auto route to RAG
    if (hasSelectedDoc) {
      state.intent = 'RAG_ONLY';
      state.thoughtProcess.push({
        agent: 'SUPERVISOR',
        status: 'DONE',
        thought: `Tài liệu (${state.selectedDocId}) đang được chọn. AI định tuyến trực tiếp vào RAG Retrieval Engine.`,
        timestamp: Date.now()
      });
      return state;
    }

    let userIntent: UserIntent = 'RAG_ONLY';
    let reasoning = 'AI Supervisor đã phân tích ngữ nghĩa và định tuyến luồng xử lý.';

    try {
      const classification = await this.llm.generateJSON<{
        intent: UserIntent;
        reasoning: string;
      }>([
        {
          role: 'system',
          content: `You are Lexifin's Intelligent Supervisor Router. Analyze the user prompt semantically and classify intent into exactly one of four categories:
1. "RAG_ONLY": Any questions about candidate CVs, contracts, legal clauses, terms, uploaded files, or document text.
2. "SQL_ONLY": Questions purely about system database metrics, transactions, revenue, customer names, or sales database numbers.
3. "HYBRID_AUDIT": Prompts asking to compare, audit, cross-check, or verify contract claims against sales database records.
4. "GENERAL_CHAT": Basic greetings ("hi", "chào bạn") or general chit-chat.

Respond strictly in JSON:
{
  "intent": "RAG_ONLY" | "SQL_ONLY" | "HYBRID_AUDIT" | "GENERAL_CHAT",
  "reasoning": "Short Vietnamese explanation of why this intent was selected"
}`
        },
        { role: 'user', content: prompt }
      ], { task: 'QUERY_REWRITE' });

      if (classification?.intent) {
        userIntent = classification.intent;
        reasoning = classification.reasoning || reasoning;
      }
    } catch (err) {
      console.warn('Supervisor AI dynamic routing notice: falling back to RAG_ONLY', err);
    }

    state.intent = userIntent;
    state.thoughtProcess.push({
      agent: 'SUPERVISOR',
      status: 'DONE',
      thought: `AI định tuyến luồng [${userIntent}]: ${reasoning}`,
      timestamp: Date.now()
    });

    return state;
  }
}
