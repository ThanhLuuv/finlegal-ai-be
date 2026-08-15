// Native Cloudflare Workers AI Client (Qwen2.5 / Llama 3.3 / Llama 3.1 / Gemini 2.5 Flash)

import { LLMMessage, extractLLMResponseText } from './types';

export class WorkersAiClient {
  private ai: Ai;

  constructor(ai: Ai) {
    this.ai = ai;
  }

  public async generateText(
    messages: LLMMessage[],
    temperature = 0.1,
    maxTokens = 2048,
    modelOverride?: string
  ): Promise<string | null> {
    if (!this.ai) return null;

    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));

    if (modelOverride) {
      try {
        const response = await (this.ai as any).run(modelOverride, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });
        const extracted = extractLLMResponseText(response);
        if (extracted) return extracted;
      } catch (err) {
        console.warn(`Model override ${modelOverride} failed:`, err);
      }
    }

    // Recommended Workers AI Model Catalog (Qwen 2.5 > Llama 3.3/3.1 > Gemini)
    const models = [
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct',
      'google/gemini-2.5-flash',
      '@cf/mistral/mistral-7b-instruct-v0.1'
    ];

    for (const modelName of models) {
      try {
        console.log(`[Workers AI Executing] Calling model: ${modelName}...`);
        const response = await (this.ai as any).run(modelName, {
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        });

        const extractedText = extractLLMResponseText(response);
        if (extractedText && extractedText.trim().length > 0) {
          console.log(`[LLM Success] Workers AI model ${modelName} returned ${extractedText.length} chars.`);
          return extractedText.trim();
        }
      } catch (err) {
        console.warn(`Workers AI model ${modelName} notice:`, String(err));
      }
    }

    return null;
  }
}
