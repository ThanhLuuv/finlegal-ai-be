// Direct DeepSeek REST API Client (DeepSeek-V3 / DeepSeek-R1 API Client)

import { LLMMessage } from './types';

export class DeepSeekClient {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  public async generateContent(messages: LLMMessage[], temperature = 0.1, maxTokens = 2048): Promise<string | null> {
    if (!this.apiKey) return null;

    const deepseekModels = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];
    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));

    for (const modelName of deepseekModels) {
      try {
        const deepseekUrl = 'https://api.deepseek.com/chat/completions';
        const res = await fetch(deepseekUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens
          })
        });

        if (res.ok) {
          const data = await res.json() as any;
          const text = data.choices?.[0]?.message?.content;
          if (text && text.trim().length > 0) {
            console.log(`[Direct DeepSeek API Success] Model ${modelName} returned ${text.length} chars.`);
            return text.trim();
          }
        }
      } catch (err) {
        console.warn(`Direct DeepSeek API model ${modelName} notice:`, err);
      }
    }

    return null;
  }
}
