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
Target Selected Document ID: ${state.selectedDocId || 'NONE'}

Analyze the user prompt semantically and classify intent into exactly ONE category:

1. "GENERAL_CHAT": Basic greetings ("chào bạn", "hi"), bot identity/capability questions ("tên bạn là gì", "bạn là ai", "bạn làm được gì", "ai tạo ra bạn"), casual chit-chat, thank you.
2. "RAG_ONLY": Any questions searching contracts, legal clauses, candidates, resumes/CVs, uploaded document text, applicant info, policies, terms, or when asking questions about a selected document.
3. "SQL_ONLY": Questions purely asking about system database sales tables, revenue metrics, transaction counts, or database customer numbers. DO NOT select SQL_ONLY if a document is selected or if prompt asks about CVs/candidates/contracts.
4. "HYBRID_AUDIT": Prompts asking to compare, audit, cross-check, or verify contract claims against sales database records.

IMPORTANT RULES:
- If a document is target selected (${state.selectedDocId || 'NONE'}), and the user is asking ANY question about names, candidates, positions, clauses, or text content in that document, you MUST classify as "RAG_ONLY".

Respond strictly in JSON:
{
  "intent": "GENERAL_CHAT" | "RAG_ONLY" | "SQL_ONLY" | "HYBRID_AUDIT",
  "reasoning": "Giải thích ngắn gọn bằng Tiếng Việt lý do chọn luồng này"
}`
        },
        { role: 'user', content: prompt }
      ], { task: 'QUERY_REWRITE' });

      if (classification?.intent) {
        // Hard override safeguard: If document selected and prompt is asking about document content, force RAG_ONLY if mistakenly classified as SQL_ONLY
        if (hasSelectedDoc && classification.intent === 'SQL_ONLY') {
          userIntent = 'RAG_ONLY';
          reasoning = 'Phát hiện tài liệu được chọn. Tự động định tuyến sang RAG_ONLY để tìm kiếm ngữ cảnh văn bản.';
        } else {
          userIntent = classification.intent;
          reasoning = classification.reasoning || reasoning;
        }
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
