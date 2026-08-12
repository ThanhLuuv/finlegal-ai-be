// Base Agent Abstraction Layer

import { AgentRole, AgentThoughtStep, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';

export abstract class BaseAgent {
  public abstract role: AgentRole;
  protected llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Helper to append a reasoning thought step to the state trajectory.
   */
  protected recordThought(state: MultiAgentState, thought: string, data?: unknown): AgentThoughtStep {
    const step: AgentThoughtStep = {
      agent: this.role,
      status: 'EXECUTING',
      thought,
      data,
      timestamp: Date.now()
    };
    state.thoughtProcess.push(step);
    return step;
  }

  public abstract execute(state: MultiAgentState): Promise<MultiAgentState>;
}
