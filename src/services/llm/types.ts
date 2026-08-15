// LLM Provider Service Types & Interfaces

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ModelRole = 
  | 'SMALL_LLM' 
  | 'PRIMARY_LLM' 
  | 'COMPLEX_LLM' 
  | 'EMBEDDING_MODEL' 
  | 'QUERY_REWRITE' 
  | 'MAIN_ANSWER' 
  | 'STRUCTURE_PARSING';

export interface LLMOptions {
  temperature?: number;
  max_tokens?: number;
  jsonMode?: boolean;
  task?: ModelRole;
  modelOverride?: string;
}

export function extractLLMResponseText(res: any): string | null {
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
