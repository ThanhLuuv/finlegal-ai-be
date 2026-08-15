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
  if (typeof res === 'object') {
    try {
      const jsonStr = JSON.stringify(res);
      const textMatch = jsonStr.match(/"response"\s*:\s*"([^"]+)"/i) || jsonStr.match(/"content"\s*:\s*"([^"]+)"/i) || jsonStr.match(/"text"\s*:\s*"([^"]+)"/i);
      if (textMatch && textMatch[1] && textMatch[1].length > 5) {
        return textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } catch {}
  }
  return null;
}

import { stripPDFSyntaxNoise, isPDFSyntaxChunk, extractEmbeddedImagesFromPDF } from '../utils/pdfExtractor';

export class LLMProviderService {
  private ai: Ai;
  private openaiApiKey?: string;

  constructor(ai: Ai, openaiApiKey?: string) {
    this.ai = ai;
    this.openaiApiKey = openaiApiKey;
  }

  /**
   * Directly extracts and structures PDF documents using Multimodal Vision AI.
   */
  public async processMultimodalDocument(pdfBuffer: ArrayBuffer, fileName: string): Promise<string | null> {
    if (pdfBuffer.byteLength > 25 * 1024 * 1024) return null;

    const base64Str = arrayBufferToBase64(pdfBuffer);

    // 1. Primary Engine: Workers AI Native `google/gemini-2.5-flash` Multimodal Model (Zero external key, 1M context)
    if (this.ai) {
      try {
        console.log(`[Workers AI Native] Calling google/gemini-2.5-flash for document: ${fileName}...`);
        
        // Try Native Gemini Parts Format first
        try {
          const response = await (this.ai as any).run('google/gemini-2.5-flash', {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'application/pdf',
                      data: base64Str
                    }
                  },
                  {
                    text: `You are an expert AI Document OCR & Structure Extractor. Extract ALL text, candidate names, contact information, work history, education, skills, dates, and tables from the attached document. Return ONLY pristine Markdown formatted text. Preserve all facts accurately.`
                  }
                ]
              }
            ]
          }) as any;

          const extractedText = extractLLMResponseText(response);
          if (extractedText && extractedText.trim().length > 20 && !extractedText.includes('dUueV')) {
            console.log(`[Workers AI Gemini 2.5 Flash Success] Extracted ${extractedText.length} chars.`);
            return extractedText.trim();
          }
        } catch (geminiNativeErr: any) {
          const errStr = String(geminiNativeErr);
          if (errStr.includes('2021') || errStr.includes('Invalid User Credentials')) {
            console.warn('[Workers AI Gemini 2.5 Flash] Entitlement notice: Cloudflare Workers AI free tier require paid plan/credentials for Google models.');
          } else {
            console.warn('[Workers AI Gemini 2.5 Flash Native format notice]:', geminiNativeErr);
          }
        }
      } catch (cfGeminiErr) {
        console.warn('[Workers AI Gemini 2.5 Flash] Notice:', cfGeminiErr);
      }
    }

    // 2. Secondary Engine: Try Direct Google Gemini REST API or OpenAI / AgentRouter Multimodal Vision API if API Key is available
    if (this.openaiApiKey) {
      const isApiKeyFormat = this.openaiApiKey.startsWith('AIza');

      // 2a. Direct Google Gemini REST API (Supports Gemini Keys AIza... or Bearer token AQ.Ab...)
      try {
        const geminiModels = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'];
        for (const gModel of geminiModels) {
          try {
            console.log(`[Direct Gemini Vision API] Calling ${gModel} with Gemini Token...`);
            const geminiUrl = isApiKeyFormat
              ? `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${this.openaiApiKey}`
              : `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent`;

            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (!isApiKeyFormat) {
              headers['Authorization'] = `Bearer ${this.openaiApiKey}`;
            }

            const res = await fetch(geminiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'application/pdf',
                          data: base64Str
                        }
                      },
                      {
                        text: 'You are an expert AI Document OCR & Structure Extractor. Extract ALL text, candidate names, contact information, work history, education, skills, dates, and tables from the attached document into pristine Markdown format.'
                      }
                    ]
                  }
                ],
                generationConfig: { temperature: 0.1 }
              })
            });

            if (res.ok) {
              const data = await res.json() as any;
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text && text.trim().length > 20) {
                console.log(`[Direct Gemini Vision API Success] Model ${gModel} extracted ${text.length} chars.`);
                return text.trim();
              }
            } else {
              const errBody = await res.text();
              console.warn(`[Direct Gemini Vision API ${gModel} HTTP ${res.status}]:`, errBody.slice(0, 300));
            }
          } catch (gErr) {
            console.warn(`Direct Gemini model ${gModel} notice:`, gErr);
          }
        }
      } catch (geminiFetchErr) {
        console.warn('Direct Gemini API fallback notice:', geminiFetchErr);
      }

      // 2b. AgentRouter / OpenAI API - Extract embedded JPEG image data URL for Vision Models
      try {
        const embeddedImages = extractEmbeddedImagesFromPDF(pdfBuffer);
        const imageUrls = embeddedImages.length > 0 ? embeddedImages : [`data:image/jpeg;base64,${base64Str}`];

        const endpoints = [
          'https://gateway.ai.cloudflare.com/v1/78eede6ec04d52fe8b367f14cecb7c08/gemini/compat/chat/completions',
          'https://agentrouter.org/v1/chat/completions',
          'https://api.openai.com/v1/chat/completions'
        ];
        const visionModels = ['gpt-4o', 'gpt-4o-mini', 'gemini-1.5-flash', 'claude-3-5-sonnet'];

        for (const endpoint of endpoints) {
          for (const modelName of visionModels) {
            try {
              console.log(`[Multimodal Vision API] Calling ${modelName} at ${endpoint}...`);
              const userContentParts: any[] = [
                { type: 'text', text: `Please extract all readable text from scanned document file: ${fileName}` }
              ];
              for (const imgUrl of imageUrls) {
                userContentParts.push({ type: 'image_url', image_url: { url: imgUrl } });
              }

              const reqHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openaiApiKey}`
              };
              if (endpoint.includes('gateway.ai.cloudflare.com')) {
                reqHeaders['cf-aig-authorization'] = `Bearer ${this.openaiApiKey}`;
              }

              const res = await fetch(endpoint, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify({
                  model: modelName,
                  messages: [
                    {
                      role: 'system',
                      content: 'You are an expert AI Document OCR & Vision Transcriber. Extract ALL text, candidate names, contact information, work history, education, skills, dates, and tables from the attached document images. Return ONLY pristine Markdown formatted text. Preserve all facts accurately.'
                    },
                    {
                      role: 'user',
                      content: userContentParts
                    }
                  ],
                  temperature: 0.1
                })
              });

              if (res.ok) {
                const data = await res.json() as any;
                const content = data.choices?.[0]?.message?.content;
                if (content && content.trim().length > 20) {
                  console.log(`[Multimodal Vision API Success] Model ${modelName} extracted ${content.length} chars.`);
                  return content.trim();
                }
              } else {
                const errBody = await res.text();
                console.warn(`[Multimodal Vision API ${modelName} at ${endpoint} HTTP ${res.status}]:`, errBody.slice(0, 300));
              }
            } catch (err) {
              console.warn(`Vision model ${modelName} notice:`, err);
            }
          }
        }
      } catch (err) {
        console.warn('Multimodal OpenAI API fallback notice:', err);
      }
    }

    // 3. Fallback to Cloudflare Workers AI Text Models (Only if text is valid human text, not compressed binary noise)
    const textDecoder = new TextDecoder('utf-8');
    let rawStr = '';
    try { rawStr = textDecoder.decode(pdfBuffer); } catch {}

    let cleanedSample = stripPDFSyntaxNoise(rawStr);
    if (!cleanedSample || cleanedSample.trim().length < 20 || isPDFSyntaxChunk(cleanedSample)) {
      return null;
    }

    const compactText = cleanedSample.slice(0, 12000);

    const visionModels = [
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/mistral/mistral-7b-instruct-v0.1'
    ];

    if (this.ai && compactText.trim().length > 20) {
      for (const modelName of visionModels) {
        try {
          console.log(`[LLM Vision] Calling Workers AI Model: ${modelName}...`);
          const response = await (this.ai as any).run(modelName, {
            messages: [
              {
                role: 'system',
                content: 'You are an expert AI Document Extractor. Extract ALL text, candidate names, contact details, skills, work experience, section titles, and tables accurately into clean Markdown format. Return ONLY the extracted text.'
              },
              {
                role: 'user',
                content: `FILENAME: ${fileName}\n\nDOCUMENT TEXT SAMPLE:\n${compactText}`
              }
            ]
          }) as any;

          const extractedText = extractLLMResponseText(response);
          if (extractedText && extractedText.trim().length > 20) {
            console.log(`[LLM Vision Success] Workers AI model ${modelName} extracted ${extractedText.length} chars.`);
            return extractedText.trim();
          }
        } catch (cfErr) {
          console.warn(`[LLM Vision Notice] Workers AI model ${modelName} notice:`, cfErr);
        }
      }
    }

    return null;
  }

  /**
   * AI-powered Document Text Normalizer & Fact Preserving Repair.
   * Cleans up garbled spacing, restores missing Vietnamese diacritics/headers, and formats document text into structured Markdown.
   */
  public async normalizeAndRepairDocumentText(rawText: string, fileName: string): Promise<string> {
    if (!rawText || rawText.trim().length < 10) return rawText;

    try {
      const prompt: LLMMessage[] = [
        {
          role: 'system',
          content: `Bạn là Hệ thống AI Chuyên gia Chuẩn hóa & Khôi phục Văn bản Tài liệu.
Nhiệm vụ của bạn là đọc bản trích xuất thô từ tập tin PDF (${fileName}), sửa các lỗi mã hóa, lỗi dính chữ/tách chữ rác, khôi phục tiêu đề mục và trả về văn bản Markdown sạch sẽ.
QUY TẮC BẮT BUỘC:
1. GIỮ NGUYÊN 100% SỰ THẬT: Tên ứng viên, số điện thoại, email, địa chỉ, công ty, chức danh, thời gian làm việc, kỹ năng, dự án, v.v. Không tự bịa thêm thông tin.
2. Trình bày dưới dạng Markdown rõ ràng với các tiêu đề mục (# Thông tin cá nhân, # Kinh nghiệm làm việc, # Học vấn, # Kỹ năng...).
3. Không kèm lời thoại hay nhận xét cá nhân, chỉ trả về nội dung văn bản đã được chuẩn hóa.`
        },
        {
          role: 'user',
          content: `TÊN TỆP: ${fileName}\n\nVĂN BẢN THÔ CẦN CHUẨN HÓA:\n${rawText.slice(0, 15000)}`
        }
      ];

      const cleaned = await this.generateText(prompt, { temperature: 0.1 });
      if (cleaned && cleaned.trim().length > 20) {
        return cleaned.trim();
      }
    } catch (err) {
      console.warn('[LLMProviderService] normalizeAndRepairDocumentText notice:', err);
    }

    return rawText;
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
        console.log(`[LLM Model Override] Calling ${options.modelOverride}...`);
        const response = await (this.ai as any).run(options.modelOverride, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });
        const extracted = extractLLMResponseText(response);
        if (extracted) return extracted;
      } catch (err) {
        console.warn(`Model override ${options.modelOverride} failed:`, err);
      }
    }

    // 1. Primary Engine: If AgentRouter / OpenAI API key is configured, use it first
    if (this.openaiApiKey) {
      try {
        console.log(`[LLM Executing] Task: ${task} -> Calling AgentRouter API...`);
        const agentRouterResult = await this.callOpenAIAPI(messages, temperature);
        if (agentRouterResult && agentRouterResult.trim().length > 0) {
          return agentRouterResult.trim();
        }
      } catch (agentRouterErr) {
        console.warn('[LLM Notice] AgentRouter API notice:', agentRouterErr);
      }
    }

    // Active Workers AI valid model catalog mapping
    const models = [
      'google/gemini-2.5-flash',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/mistral/mistral-7b-instruct-v0.1'
    ];

    // 2. Secondary Engine: Cloudflare Workers AI Edge models
    for (const modelName of models) {
      try {
        console.log(`[LLM Executing] Task: ${task} -> Calling Workers AI Model: ${modelName}...`);
        const response = await (this.ai as any).run(modelName, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });

        const extractedText = extractLLMResponseText(response);
        if (extractedText) {
          console.log(`[LLM Success] Model ${modelName} returned ${extractedText.length} chars.`);
          return extractedText;
        }
      } catch (err) {
        console.warn(`[LLM Notice] Workers AI model ${modelName} notice:`, String(err));
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
    // 1. Direct Google Gemini REST API (Supports Gemini API Keys AQ.Ab... / AIzaSy...)
    if (this.openaiApiKey) {
      const geminiModels = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'];
      const promptText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

      for (const gModel of geminiModels) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${this.openaiApiKey}`;
          const res = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { temperature }
            })
          });

          if (res.ok) {
            const data = await res.json() as any;
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim().length > 0) {
              console.log(`[Direct Gemini API Success] Model ${gModel} returned ${text.length} chars.`);
              return text.trim();
            }
          }
        } catch (gErr) {
          console.warn(`Direct Gemini API model ${gModel} notice:`, gErr);
        }
      }
    }

    // 2. OpenAI / AgentRouter / Cloudflare AI Gateway Compatible Proxy APIs
    const endpoints = [
      'https://gateway.ai.cloudflare.com/v1/78eede6ec04d52fe8b367f14cecb7c08/gemini/compat/chat/completions',
      'https://agentrouter.org/v1/chat/completions',
      'https://api.openai.com/v1/chat/completions'
    ];
    const models = ['gpt-4o-mini', 'gpt-4o', 'gemini-1.5-flash', 'claude-3-5-sonnet'];
    const formatted = messages.map(m => ({ role: m.role, content: m.content }));

    for (const endpoint of endpoints) {
      for (const modelName of models) {
        try {
          const reqHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          };
          if (endpoint.includes('gateway.ai.cloudflare.com')) {
            reqHeaders['cf-aig-authorization'] = `Bearer ${this.openaiApiKey}`;
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: reqHeaders,
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
