// Unified LLM Provider Service (Cloudflare Workers AI + Gemini Fallback)

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  max_tokens?: number;
  jsonMode?: boolean;
}

export class LLMProviderService {
  private ai: Ai;
  private geminiApiKey?: string;

  constructor(ai: Ai, geminiApiKey?: string) {
    this.ai = ai;
    this.geminiApiKey = geminiApiKey;
  }

  /**
   * Generates completion from LLM with automatic JSON parsing support.
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens ?? 2048;

    try {
      // Primary: Use Cloudflare Workers AI (Llama 3.1 8B Instruct)
      const response = await (this.ai as any).run('@cf/meta/llama-3.1-8b-instruct', {
        messages,
        temperature,
        max_tokens: maxTokens,
      });

      if (response && response.response) {
        return response.response;
      }
    } catch (err) {
      console.warn('Workers AI primary model failed, attempting fallback or secondary model...', err);
    }

    // Fallback: If Gemini API Key is provided in environment variables
    if (this.geminiApiKey) {
      return await this.callGeminiAPI(messages, temperature);
    }

    // Secondary Fallback: Use Qwen 2.5 on Workers AI
    try {
      const response = await (this.ai as any).run('@cf/qwen/qwen2.5-7b-instruct', {
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      return response.response;
    } catch (finalErr) {
      throw new Error(`LLM Generation Failure: ${finalErr instanceof Error ? finalErr.message : String(finalErr)}`);
    }
  }

  /**
   * Generates structured JSON output from LLM prompt.
   */
  public async generateJSON<T>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    const systemPrompt: LLMMessage = {
      role: 'system',
      content: 'CRITICAL REQUIREMENT: You MUST respond ONLY with valid, minified raw JSON. Do NOT include markdown codeblocks (```json), commentary, or extra whitespace.'
    };

    const fullMessages = [systemPrompt, ...messages];
    const rawText = await this.generateText(fullMessages, { ...options, temperature: 0.0 });
    
    // Clean up codeblock markers if model accidentally includes them
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (parseError) {
      console.error('Failed to parse LLM JSON output:', cleaned);
      throw new Error(`LLM JSON Parse Error: Invalid JSON response received from LLM.`);
    }
  }

  private async callGeminiAPI(messages: LLMMessage[], temperature: number): Promise<string> {
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemInstruction = messages.find(m => m.role === 'system')?.content;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;
    
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature }
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Gemini API HTTP Error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as any;
    return data.candidates[0].content.parts[0].text;
  }
}
