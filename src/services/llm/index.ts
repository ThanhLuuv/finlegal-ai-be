// Unified LLM Provider Orchestrator

import { LLMMessage, LLMOptions } from './types';
import { DeepSeekClient } from './deepseekClient';
import { WorkersAiClient } from './workersAiClient';
import { DEMO_LIMITS, DemoLimitError } from '../../core/demoLimits';

export * from './types';

export class LLMProviderService {
  private providerAttempts = 0;
  private apiKey?: string;
  private deepseekClient: DeepSeekClient;
  private workersAiClient: WorkersAiClient;

  constructor(ai: Ai, apiKey?: string) {
    this.apiKey = apiKey;
    this.deepseekClient = new DeepSeekClient(apiKey);
    this.workersAiClient = new WorkersAiClient(ai);
  }

  /**
   * Generates text completion with DeepSeek API & Workers AI Free Models Strategy
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    if (messages.reduce((total, message) => total + message.content.length, 0) > DEMO_LIMITS.maxInputChars) {
      throw new DemoLimitError('Ngữ cảnh yêu cầu vượt ngưỡng demo. Vui lòng hỏi một phần nhỏ hơn của tài liệu hoặc bắt đầu cuộc trò chuyện mới.');
    }
    const smallTask = ['QUERY_REWRITE', 'PRIMARY_LLM'].includes(options.task || '');
    const maxTokens = Math.min(options.max_tokens ?? (smallTask ? 256 : 1024), DEMO_LIMITS.maxOutputTokens);
    const takeAttempt = () => {
      if (this.providerAttempts >= DEMO_LIMITS.maxProviderAttempts) throw new DemoLimitError('Yêu cầu cần quá nhiều lượt gọi AI cho bản demo. Vui lòng chia nhỏ câu hỏi hoặc thử lại sau.');
      this.providerAttempts++;
    };

    // 1. Direct DeepSeek API (deepseek-flash - served by DeepSeek-V4.1-Flash-1017) if API key is configured
    if (this.apiKey) {
      takeAttempt();
      try {
        const res = await this.deepseekClient.generateContent(messages, temperature, maxTokens);
        if (res && res.trim().length > 0) return res.trim();
      } catch (err) {
        console.warn('DeepSeek External API notice:', err);
      }
    }

    // 2. One bounded fallback to a small Workers AI model.
    takeAttempt();
    const workersRes = await this.workersAiClient.generateText(messages, temperature, maxTokens, options.modelOverride);
    if (workersRes && workersRes.trim().length > 0) {
      return workersRes.trim();
    }

    throw new Error('LLM Generation Failure: All DeepSeek AI models on Workers AI and API fallbacks were unavailable.');
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
