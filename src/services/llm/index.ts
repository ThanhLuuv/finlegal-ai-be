// Unified LLM Provider Orchestrator

import { LLMMessage, LLMOptions } from './types';
import { GeminiClient } from './geminiClient';
import { WorkersAiClient } from './workersAiClient';

export * from './types';

export class LLMProviderService {
  private ai: Ai;
  private apiKey?: string;
  private geminiClient: GeminiClient;
  private workersAiClient: WorkersAiClient;

  constructor(ai: Ai, apiKey?: string) {
    this.ai = ai;
    this.apiKey = apiKey;
    this.geminiClient = new GeminiClient(apiKey);
    this.workersAiClient = new WorkersAiClient(ai);
  }

  /**
   * Generates text completion with Multi-Tier Fallback Strategy
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens ?? 2048;

    // 1. Direct Gemini API (if API Key configured)
    if (this.apiKey) {
      try {
        const res = await this.geminiClient.generateContent(messages, temperature);
        if (res && res.trim().length > 0) return res.trim();
      } catch (err) {
        console.warn('Gemini API call notice:', err);
      }
    }

    // 2. Workers AI Edge Models
    const workersRes = await this.workersAiClient.generateText(messages, temperature, maxTokens, options.modelOverride);
    if (workersRes) return workersRes.trim();

    throw new Error('LLM Generation Failure: All AI models and API fallbacks were unavailable.');
  }

  /**
   * Generates structured JSON output from LLM prompt with robust parsing and recovery.
   */
  public async generateJSON<T>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    const systemPrompt: LLMMessage = {
      role: 'system',
      content: 'CRITICAL REQUIREMENT: You MUST respond ONLY with valid raw JSON. Do NOT wrap in markdown codeblocks (```json) or include extra commentary.'
    };

    const fullMessages = [systemPrompt, ...messages];
    const rawText = await this.generateText(fullMessages, { ...options, temperature: 0.0 });

    let cleaned = rawText.trim();
    const firstBrace = cleaned.search(/[\{\[]/);
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    cleaned = cleaned
      .replace(/,\s*([\}\]])/g, '$1')
      .replace(/\/\/.*$/gm, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const fallbackCleaned = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1');
          return JSON.parse(fallbackCleaned) as T;
        } catch {}
      }
      throw new Error(`LLM JSON Parse Error: Invalid JSON response received.`);
    }
  }
}
