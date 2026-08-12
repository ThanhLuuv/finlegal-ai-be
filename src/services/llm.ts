// Unified LLM Provider Service (Gemini 2.0 Flash / 1.5 Flash + Workers AI 2026 Multilingual Fallback)

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  max_tokens?: number;
  jsonMode?: boolean;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class LLMProviderService {
  private ai: Ai;
  private geminiApiKey?: string;
  private openaiApiKey?: string;

  constructor(ai: Ai, geminiApiKey?: string, openaiApiKey?: string) {
    this.ai = ai;
    this.geminiApiKey = geminiApiKey;
    this.openaiApiKey = openaiApiKey;
  }

  /**
   * Directly extracts and structures PDF documents using Gemini 2.0 Multimodal Vision AI.
   * Handles complex fonts, Canva exports, tables, and Vietnamese text natively without hardcoded rules.
   */
  public async processMultimodalDocument(pdfBuffer: ArrayBuffer, fileName: string): Promise<string | null> {
    if (!this.geminiApiKey) return null;

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const base64Data = arrayBufferToBase64(pdfBuffer);

    for (const modelName of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.geminiApiKey}`;
        const body = {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Data
                  }
                },
                {
                  text: `You are an expert AI Document Intelligence Engine for FinLegal AI.
Examine this PDF file "${fileName}".
Extract ALL text, candidate names, job titles, phone numbers, addresses, experience dates, skills, contract clauses, and tables.
Convert everything into clean, beautifully structured Vietnamese/English Markdown format.
Preserve 100% of facts, dates, names, and numbers accurately.`
                }
              ]
            }
          ]
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const data = await res.json() as any;
          const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (extractedText && extractedText.trim().length > 20) {
            return extractedText.trim();
          }
        }
      } catch (err) {
        console.warn(`Gemini Multimodal AI model ${modelName} notice:`, err);
      }
    }

    return null;
  }

  /**
   * Generates completion from LLM with automatic JSON parsing support.
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens ?? 2048;
    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));

    // Option A: If OpenAI API Key is provided, use GPT-4o / OpenAI GPT models
    if (this.openaiApiKey) {
      try {
        return await this.callOpenAIAPI(messages, temperature);
      } catch (openaiErr) {
        console.warn('OpenAI API call failed, trying Gemini API:', openaiErr);
      }
    }

    // Option B: If Gemini API key is provided, use Gemini 2.5 Flash / 2.0 Flash
    if (this.geminiApiKey) {
      try {
        return await this.callGeminiAPI(messages, temperature);
      } catch (geminiErr) {
        console.warn('Gemini API call failed, falling back to Workers AI models:', geminiErr);
      }
    }

    // Option C: Official Cloudflare Workers AI text generation models list
    const models = [
      '@cf/meta/llama-3.3-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/qwen/qwen1.5-14b-chat-awq',
      '@cf/mistral/mistral-7b-instruct-v0.1'
    ];

    for (const modelName of models) {
      try {
        const response = await (this.ai as any).run(modelName, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });

        if (response && response.response) {
          return response.response;
        }
      } catch (err) {
        console.warn(`Workers AI model ${modelName} failed, trying next fallback...`, err);
      }
    }

    throw new Error('LLM Generation Failure: All OpenAI, Gemini API, and Workers AI fallbacks were unavailable.');
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

    // 1. Extract JSON object or array substring using regex boundary matching
    const firstBrace = cleaned.search(/[\{\[]/);
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    // 2. Sanitize common LLM syntax flaws (trailing commas before } or ])
    cleaned = cleaned
      .replace(/,\s*([\}\]])/g, '$1')
      .replace(/\/\/.*$/gm, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (parseError) {
      // 3. Fallback: regex search for object pattern
      const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const fallbackCleaned = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1');
          return JSON.parse(fallbackCleaned) as T;
        } catch {
          // ignore
        }
      }
      console.error('Failed to parse LLM JSON output. Raw text was:', rawText);
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
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];


    for (const modelName of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.geminiApiKey}`;
        
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

        if (res.ok) {
          const data = await res.json() as any;
          return data.candidates[0].content.parts[0].text;
        }
      } catch {
        // try next model
      }
    }

    throw new Error('Gemini API call failed for all configured Gemini models.');
  }

  private async callOpenAIAPI(messages: LLMMessage[], temperature: number): Promise<string> {
    const endpoints = [
      'https://agentrouter.org/v1/chat/completions',
      'https://api.openai.com/v1/chat/completions'
    ];
    const models = ['gpt-5.6-sol', 'gpt-5.5', 'claude-opus-4-6', 'gpt-4o', 'glm-5.2'];
    const formatted = messages.map(m => ({ role: m.role, content: m.content }));

    for (const endpoint of endpoints) {
      for (const modelName of models) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.openaiApiKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages: formatted,
              temperature
            })
          });

          if (res.ok) {
            const data = await res.json() as any;
            const content = data.choices?.[0]?.message?.content;
            if (content) return content;
          }
        } catch (err) {
          console.warn(`OpenAI/AgentRouter model ${modelName} at ${endpoint} notice:`, err);
        }
      }
    }

    throw new Error('OpenAI/AgentRouter API call failed for all configured endpoints & models.');
  }
}




