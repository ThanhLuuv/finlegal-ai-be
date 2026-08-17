// Unified LLM Provider Orchestrator

import { LLMMessage, LLMOptions } from './types';
import { DeepSeekClient } from './deepseekClient';
import { GeminiClient } from './geminiClient';
import { WorkersAiClient } from './workersAiClient';

export * from './types';

export class LLMProviderService {
  private ai: Ai;
  private apiKey?: string;
  private deepseekClient: DeepSeekClient;
  private geminiClient: GeminiClient;
  private workersAiClient: WorkersAiClient;

  constructor(ai: Ai, apiKey?: string) {
    this.ai = ai;
    this.apiKey = apiKey;
    this.deepseekClient = new DeepSeekClient(apiKey);
    this.geminiClient = new GeminiClient(apiKey);
    this.workersAiClient = new WorkersAiClient(ai);
  }

  /**
   * Generates text completion prioritizing Cloudflare Workers AI Native Model (@cf/deepseek-ai/deepseek-v4-flash-0731) - 100% Free Edge Execution
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens ?? 2048;
    const targetModel = options.modelOverride || '@cf/deepseek-ai/deepseek-v4-flash-0731';

    // 1. Cloudflare Workers AI Edge Model FIRST (@cf/deepseek-ai/deepseek-v4-flash-0731)
    try {
      const workersRes = await this.workersAiClient.generateText(messages, temperature, maxTokens, targetModel);
      if (workersRes && workersRes.trim().length > 0) {
        return workersRes.trim();
      }
    } catch (err) {
      console.warn('Cloudflare Workers AI execution notice:', err);
    }

    // 2. Direct DeepSeek External API Fallback
    if (this.apiKey) {
      try {
        const res = await this.deepseekClient.generateContent(messages, temperature, maxTokens);
        if (res && res.trim().length > 0) return res.trim();
      } catch (err) {
        console.warn('DeepSeek External API fallback notice:', err);
      }
    }

    throw new Error('LLM Generation Failure: All DeepSeek AI models on Cloudflare Workers AI and API fallbacks were unavailable.');
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
