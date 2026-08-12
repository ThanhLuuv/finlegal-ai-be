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

    let userIntent: UserIntent = 'HYBRID_AUDIT';
    let reasoning = 'Performing comprehensive contract and database cross-audit analysis.';

    try {
      const classification = await this.llm.generateJSON<{
        intent: UserIntent;
        reasoning: string;
      }>([
        {
          role: 'system',
          content: `You are the Supervisor Agent of FinLegal AI. Analyze the user prompt and classify intent into one of four categories:
1. "RAG_ONLY": Questions purely about terms, clauses, definitions, or text inside uploaded PDF contracts/documents.
2. "SQL_ONLY": Questions purely about system database metrics, sales figures, transactions, or revenue numbers.
3. "HYBRID_AUDIT": Prompts asking to compare, audit, cross-check, or verify numbers/terms in contracts vs actual database sales figures.
4. "GENERAL_CHAT": General greetings, questions, or non-audit conversations.

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
      console.warn('SupervisorAgent JSON parse failed, defaulting to HYBRID_AUDIT intent');
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
