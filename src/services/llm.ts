// Unified LLM Provider Service (AgentRouter gpt-5.6-sol / claude-opus-4-6 + Cloudflare Workers AI Fallback)

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ModelRole = 'SMALL_LLM' | 'PRIMARY_LLM' | 'COMPLEX_LLM' | 'EMBEDDING_MODEL' | 'QUERY_REWRITE' | 'MAIN_ANSWER' | 'STRUCTURE_PARSING';

export interface LLMOptions {
  temperature?: number;
  max_tokens?: number;
  jsonMode?: boolean;
  task?: ModelRole;
  modelOverride?: string;
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
   * Directly extracts and structures PDF documents using Multimodal Vision AI.
   */
  public async processMultimodalDocument(pdfBuffer: ArrayBuffer, fileName: string): Promise<string | null> {
    if (pdfBuffer.byteLength > 20 * 1024 * 1024) return null;

    const base64Data = arrayBufferToBase64(pdfBuffer);

    // 1. Try Cloudflare Workers AI @cf/google/gemini-2.5-flash directly
    if (this.ai) {
      try {
        const response = await (this.ai as any).run('@cf/google/gemini-2.5-flash', {
          messages: [
            {
              role: 'system',
              content: 'You are FinLegal AI Document Extractor. Extract ALL text, candidate names, contact details, skills, work experience, section titles, and tables accurately into clean Markdown format. Return ONLY the extracted text.'
            },
            {
              role: 'user',
              content: `FILENAME: ${fileName}\n\nPDF BASE64 DATA:\n${base64Data}`
            }
          ]
        });

        if (response && response.response && response.response.trim().length > 20) {
          return response.response.trim();
        }
      } catch (cfErr) {
        console.warn('Workers AI @cf/google/gemini-2.5-flash extraction notice:', cfErr);
      }
    }

    // 2. Try Gemini Multimodal Vision API (Natively parses PDFs directly)
    if (this.geminiApiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiApiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Data
                  }
                },
                {
                  text: `FILENAME: ${fileName}\n\nTask: Read and extract ALL text, candidate names, contact info, skills, work experience, section titles, and tables accurately into clean Markdown format. Return ONLY the extracted text.`
                }
              ]
            }]
          })
        });

        if (res.ok) {
          const data = await res.json() as any;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 20) {
            return text.trim();
          }
        }
      } catch (err) {
        console.warn('Gemini 2.0 Multimodal PDF extraction notice:', err);
      }
    }

    // 3. Try OpenAI / Router Multimodal Endpoint
    if (this.openaiApiKey) {
      const endpoints = [
        'https://agentrouter.org/v1/chat/completions',
        'https://api.openai.com/v1/chat/completions'
      ];
      const models = ['gpt-4o', 'gpt-4o-mini'];

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
                messages: [
                  {
                    role: 'system',
                    content: 'You are FinLegal AI Document Extractor. Extract ALL text, candidate names, skills, clauses, experience, and tables accurately into clean Markdown format. Return ONLY the extracted Markdown text.'
                  },
                  {
                    role: 'user',
                    content: `FILENAME: ${fileName}\n\nPDF BASE64 DATA:\n${base64Data}`
                  }
                ]
              })
            });

            if (res.ok) {
              const data = await res.json() as any;
              const text = data.choices?.[0]?.message?.content;
              if (text && text.trim().length > 20) {
                return text.trim();
              }
            }
          } catch {
            // try next model
          }
        }
      }
    }

    return null;
  }

  /**
   * Generates completion with Task-Based & Role-Based Model Routing Strategy.
   */
  public async generateText(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens ?? 2048;
    const task = options.task || 'PRIMARY_LLM';
    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));

    if (options.modelOverride) {
      try {
        const response = await (this.ai as any).run(options.modelOverride, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });
        if (response && response.response) return response.response;
      } catch (err) {
        console.warn(`Model override ${options.modelOverride} failed:`, err);
      }
    }

    // Role-based model catalog mapping with @cf/google/gemini-2.5-flash as #1 primary
    let models: string[] = [];

    if (task === 'SMALL_LLM' || task === 'QUERY_REWRITE') {
      models = [
        '@cf/google/gemini-2.5-flash',
        '@cf/meta/llama-3.1-8b-instruct',
        '@cf/qwen/qwen1.5-14b-chat-awq'
      ];
    } else if (task === 'PRIMARY_LLM' || task === 'MAIN_ANSWER') {
      models = [
        '@cf/google/gemini-2.5-flash',
        '@cf/qwen/qwen3-30b-a3b-fp8',
        '@cf/meta/llama-3.3-70b-instruct'
      ];
    } else if (task === 'COMPLEX_LLM') {
      models = [
        '@cf/google/gemini-2.5-flash',
        '@cf/meta/llama-3.3-70b-instruct',
        '@cf/qwen/qwen3-30b-a3b-fp8'
      ];
    } else {
      models = [
        '@cf/google/gemini-2.5-flash',
        '@cf/qwen/qwen3-30b-a3b-fp8',
        '@cf/meta/llama-3.1-8b-instruct'
      ];
    }

function extractLLMResponseText(res: any): string | null {
  if (!res) return null;
  if (typeof res === 'string' && res.trim().length > 0) return res.trim();
  if (typeof res.response === 'string' && res.response.trim().length > 0) return res.response.trim();
  if (res.result && typeof res.result === 'string' && res.result.trim().length > 0) return res.result.trim();
  if (res.result && typeof res.result.response === 'string' && res.result.response.trim().length > 0) return res.result.response.trim();
  if (res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === 'string') {
    return res.choices[0].message.content.trim();
  }
  if (res.choices && res.choices[0] && typeof res.choices[0].text === 'string') {
    return res.choices[0].text.trim();
  }
  return null;
}

    // 1. Try Cloudflare Workers AI Edge models first
    for (const modelName of models) {
      try {
        const response = await (this.ai as any).run(modelName, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });

        const extractedText = extractLLMResponseText(response);
        if (extractedText) {
          return extractedText;
        }
      } catch (err) {
        console.warn(`Workers AI model ${modelName} notice:`, err);
      }
    }

    // 2. Fallback to AgentRouter / External API if configured
    if (this.openaiApiKey) {
      try {
        return await this.callOpenAIAPI(messages, temperature);
      } catch (openaiErr) {
        console.warn('AgentRouter API call notice:', openaiErr);
      }
    }

    throw new Error('LLM Generation Failure: All Workers AI models and API fallbacks were unavailable.');
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
