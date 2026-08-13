// RAG Query Analyzer (Flow B §10-11: Query Understanding & Rewrite using Llama 3.1 8B)

import { QueryAnalysis } from './types';
import { LLMProviderService } from '../services/llm';

export class QueryAnalyzer {
  private llm?: LLMProviderService;

  constructor(llm?: LLMProviderService) {
    this.llm = llm;
  }

  public async analyze(prompt: string, selectedDocId?: string): Promise<QueryAnalysis> {
    const cleanPrompt = (prompt || '').trim();
    let rewrittenQuery = cleanPrompt;

    // Conditional Query Rewrite: Only trigger LLM rewrite for short/ambiguous/colloquial prompts
    const words = cleanPrompt.split(/\s+/);
    const isAmbiguousOrShort = words.length < 6 || /khi nào|lúc nào|bao nhiêu|thế nào|ở đâu|ai/i.test(cleanPrompt);

    if (this.llm && isAmbiguousOrShort && cleanPrompt.length > 3) {
      try {
        const rewriteRes = await this.llm.generateText([
          {
            role: 'system',
            content: `Bạn là Chuyên gia Tối ưu hóa Truy vấn Pháp lý & Tài chính (Query Rewrite Engine).
Nhiệm vụ: Phân tích câu hỏi người dùng và bổ sung thuật ngữ chuyên môn/pháp lý giúp Vector Search tìm đúng văn bản.
Ví dụ:
- "Bên A được hủy hợp đồng lúc nào?" -> "Điều kiện để Bên A đơn phương chấm dứt hợp đồng"
- "Khi nào trả tiền?" -> "Thời hạn và phương thức thanh toán hợp đồng"

BẮT BUỘC: Trả về duy nhất 1 câu truy vấn đã tối ưu. Không viết lời dẫn.`
          },
          { role: 'user', content: cleanPrompt }
        ], { task: 'QUERY_REWRITE', temperature: 0.1, max_tokens: 120 });

        if (rewriteRes && rewriteRes.trim().length > 3) {
          rewrittenQuery = rewriteRes.trim().replace(/^["']|["']$/g, '');
        }
      } catch (err) {
        console.warn('Conditional Query Rewrite notice:', err);
      }
    }

    
    // Extract keywords using Vietnamese legal stopword filtering
    const vietnameseStopwords = new Set([
      'là', 'của', 'và', 'các', 'cho', 'được', 'này', 'đó', 'những', 'với', 
      'khi', 'sau', 'trước', 'theo', 'về', 'trong', 'tại', 'như', 'bởi', 
      'hoặc', 'mà', 'thì', 'nếu', 'đã', 'sẽ', 'đang', 'đến', 'nào', 'gì'
    ]);

    const keywords = rewrittenQuery
      .toLowerCase()
      .replace(/[^\w\sÀ-ỹ0-9]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 1 && !vietnameseStopwords.has(k));

    return {
      originalQuery: cleanPrompt,
      rewrittenQuery,
      keywords,
      targetDocId: selectedDocId
    };
  }
}


