// Dynamic AI Supervisor Router - Powered by DeepSeek-v4 Semantic Intent Understanding

import { LLMProviderService } from '../../services/llm';
import { MultiAgentState, UserIntent } from '../types';

export class SupervisorRouter {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Dynamically analyzes user prompt semantically with DeepSeek AI to route intent
   */
  public async routeIntent(state: MultiAgentState): Promise<MultiAgentState> {
    const prompt = (state.userPrompt || '').trim();
    const hasSelectedDoc = Boolean(state.selectedDocId);

    let userIntent: UserIntent = 'RAG_ONLY';
    let reasoning = 'Phân tích ngữ nghĩa DeepSeek AI hoàn tất.';

    try {
      const classification = await this.llm.generateJSON<{
        intent: UserIntent;
        reasoning: string;
      }>([
        {
          role: 'system',
          content: `You are DeepSeek Supervisor Router for Lexifin Legal RAG System.
Analyze the user prompt semantically and classify intent into exactly ONE category:

1. "GENERAL_CHAT": Basic greetings ("chào bạn", "hi"), bot identity/capability questions ("tên bạn là gì", "bạn là ai", "bạn làm được gì", "ai tạo ra bạn"), casual chit-chat, thank you, or general questions NOT requiring document lookup.
2. "RAG_ONLY": Any questions searching contracts, legal clauses, website pricing policies, terms, uploaded files, or document text.
3. "SQL_ONLY": Questions purely about system database metrics, transactions, revenue, customer names, or sales database numbers.
4. "HYBRID_AUDIT": Prompts asking to compare, audit, cross-check, or verify contract claims against sales database records.

Note: If a document ID is selected (${state.selectedDocId || 'none'}), BUT the user prompt is a casual greeting or asking bot identity (e.g. "tên m là gì", "hi"), classify strictly as "GENERAL_CHAT".

Respond strictly in JSON:
{
  "intent": "GENERAL_CHAT" | "RAG_ONLY" | "SQL_ONLY" | "HYBRID_AUDIT",
  "reasoning": "Giải thích ngắn gọn bằng Tiếng Việt lý do chọn luồng này"
}`
        },
        { role: 'user', content: prompt }
      ], { task: 'QUERY_REWRITE', modelOverride: 'granite-4.0-h-micro' });

      if (classification?.intent) {
        userIntent = classification.intent;
        reasoning = classification.reasoning || reasoning;
      }
    } catch (err) {
      console.warn('Supervisor DeepSeek AI dynamic routing notice:', err);
      userIntent = hasSelectedDoc ? 'RAG_ONLY' : 'GENERAL_CHAT';
    }

    state.intent = userIntent;
    state.thoughtProcess.push({
      agent: 'SUPERVISOR',
      status: 'DONE',
      thought: `DeepSeek AI Router định tuyến luồng [${userIntent}]: ${reasoning}`,
      timestamp: Date.now()
    });

    return state;
  }
}
