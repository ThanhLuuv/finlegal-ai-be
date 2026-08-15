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

import { stripPDFSyntaxNoise, isPDFSyntaxChunk } from '../utils/pdfExtractor';

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
          if (extractedText && extractedText.trim().length > 20) {
            console.log(`[Workers AI Gemini 2.5 Flash Success] Extracted ${extractedText.length} chars.`);
            return extractedText.trim();
          }
        } catch (geminiNativeErr) {
          console.warn('[Workers AI Gemini 2.5 Flash Native format notice]:', geminiNativeErr);
        }

        // Try Messages Format Fallback
        try {
          const response = await (this.ai as any).run('google/gemini-2.5-flash', {
            messages: [
              {
                role: 'system',
                content: 'You are an expert AI Document OCR & Vision Transcriber. Extract ALL text, candidate names, contact information, work history, education, skills, dates, and tables from the attached document into clean Markdown.'
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: `Please extract all readable text from file: ${fileName}` },
                  { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64Str}` } }
                ]
              }
            ]
          }) as any;

          const extractedText = extractLLMResponseText(response);
          if (extractedText && extractedText.trim().length > 20) {
            console.log(`[Workers AI Gemini 2.5 Flash Messages Success] Extracted ${extractedText.length} chars.`);
            return extractedText.trim();
          }
        } catch (geminiMsgErr) {
          console.warn('[Workers AI Gemini 2.5 Flash Messages format notice]:', geminiMsgErr);
        }
      } catch (cfGeminiErr) {
        console.warn('[Workers AI Gemini 2.5 Flash] Notice:', cfGeminiErr);
      }
    }

    // 2. Secondary Engine: Try OpenAI / AgentRouter Multimodal Vision API if API Key is available
    if (this.openaiApiKey) {
      try {
        const dataUrl = `data:application/pdf;base64,${base64Str}`;
        const endpoints = [
          'https://agentrouter.org/v1/chat/completions',
          'https://api.openai.com/v1/chat/completions'
        ];
        const visionModels = ['gpt-4o', 'gpt-4o-mini', 'gemini-1.5-flash', 'claude-3-5-sonnet'];

        for (const endpoint of endpoints) {
          for (const modelName of visionModels) {
            try {
              console.log(`[Multimodal Vision API] Calling ${modelName} at ${endpoint}...`);
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
                      content: 'You are an expert AI Document OCR & Vision Transcriber. Extract ALL text, candidate names, contact information, work history, education, skills, dates, and tables from the attached PDF document. Return ONLY pristine Markdown formatted text. Preserve all facts accurately.'
                    },
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: `Please extract all readable text from file: ${fileName}` },
                        { type: 'image_url', image_url: { url: dataUrl } }
                      ]
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

    // 3. Fallback to Cloudflare Workers AI Text Models
    const textDecoder = new TextDecoder('utf-8');
    let rawStr = '';
    try { rawStr = textDecoder.decode(pdfBuffer); } catch {}

    let cleanedSample = stripPDFSyntaxNoise(rawStr);
    if (!cleanedSample || cleanedSample.trim().length < 20 || isPDFSyntaxChunk(cleanedSample)) {
      const pdfKeywords = new Set([
        'TYPE', 'OUTPUTINTENT', 'GTS_PDFA1', 'STRUCTELEM', 'ENDOBJ', 'OBJ', 'STREAM', 'ENDSTREAM',
        'CIDFONTTYPE', 'CIDFONTTYPE2', 'CIDTOGIDMAP', 'CIDSYSTEMINFO', 'IDENTITY', 'SUBTYPE',
        'FONTDESCRIPTOR', 'FONTFILE', 'FONTFILE2', 'FONTFILE3', 'PROCSET', 'MEDIABOX', 'CROPBOX',
        'RESOURCES', 'PARENT', 'KIDS', 'ROOT', 'INFO', 'TRANSPARENCY', 'COUNT', 'LAST', 'GROUP'
      ]);
      const wordTokens = (rawStr.match(/[A-Za-z0-9À-ỹ]{2,}/g) || [])
        .filter(token => !pdfKeywords.has(token.toUpperCase()));
      cleanedSample = wordTokens.join(' ');
    }

    const compactText = cleanedSample.slice(0, 12000);

    const visionModels = [
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/mistral/mistral-7b-instruct-v0.1'
    ];

    if (this.ai && compactText.trim().length > 10) {
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
          if (extractedText && extractedText.trim().length > 10) {
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
