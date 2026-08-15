// Direct Google Gemini REST API Client

import { LLMMessage } from './types';

export class GeminiClient {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  public async generateContent(messages: LLMMessage[], temperature = 0.1): Promise<string | null> {
    if (!this.apiKey) return null;

    const geminiModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const promptText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    for (const gModel of geminiModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${this.apiKey}`;
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

    return null;
  }
}
