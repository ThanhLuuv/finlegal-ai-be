// Supervisor Agent (Dynamic AI Intent Classifier & Router)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState, UserIntent } from './state';
import { LLMProviderService } from '../services/llm';

export class SupervisorAgent extends BaseAgent {
  public role: AgentRole = 'SUPERVISOR';

  constructor(llm: LLMProviderService) {
    super(llm);
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Analyzing user prompt intent dynamically with AI...');

    const prompt = state.userPrompt;
    const hasSelectedDoc = Boolean(state.selectedDocId);

    let userIntent: UserIntent = 'RAG_ONLY';
    let reasoning = 'Dynamically routing intent using LLM semantic understanding.';

    try {
      const classification = await this.llm.generateJSON<{
        intent: UserIntent;
        reasoning: string;
      }>([
        {
          role: 'system',
          content: `You are the Supervisor Agent of FinLegal AI. Analyze the user prompt semantically and classify intent into one of four categories:
1. "RAG_ONLY": Any questions asking about candidate CVs, contracts, documents, terms, clauses, experience, skills, or text inside uploaded files.
2. "SQL_ONLY": Questions purely about system database metrics, transactions, revenue, customer names, or sales database numbers.
3. "HYBRID_AUDIT": Prompts asking to compare, audit, cross-check, or verify contract/document claims against actual database records.
4. "GENERAL_CHAT": Only for basic greetings (e.g. "hi", "chào bạn") or general chit-chat unrelated to documents or database metrics.

${hasSelectedDoc ? 'CONTEXT NOTE: A specific document is currently selected by the user in the UI.' : ''}

Respond strictly in JSON format:
{
  "intent": "HYBRID_AUDIT" | "RAG_ONLY" | "SQL_ONLY" | "GENERAL_CHAT",
  "reasoning": "Brief explanation of why this intent was selected"
}`
        },
        {
          role: 'user',
          content: prompt
        }
      ], { task: 'QUERY_REWRITE' });
      
      if (classification && classification.intent) {
        userIntent = classification.intent;
        reasoning = classification.reasoning || reasoning;
      }
    } catch (err) {
      console.warn('SupervisorAgent LLM intent classification notice: using default intent');
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


