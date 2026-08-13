import { QueryAnalysis, ConversationMessage, RetrievalScope } from './types';
import { LLMProviderService } from '../services/llm';

export class QueryAnalyzer {
  private llm?: LLMProviderService;

  constructor(llm?: LLMProviderService) {
    this.llm = llm;
  }

  public async analyze(prompt: string, selectedDocId?: string, history?: ConversationMessage[], scope?: RetrievalScope): Promise<QueryAnalysis> {
    const cleanPrompt = (prompt || '').trim();
    let rewrittenQuery = cleanPrompt;

    // Check for conversation history context or short/ambiguous queries
    const words = cleanPrompt.split(/\s+/);
    const hasHistory = history && history.length > 0;
    const isAmbiguousOrShort = words.length < 6 || /khi nào|lúc nào|bao nhiêu|thế nào|ở đâu|ai|cái đó|nói trên|như thế|sau đó/i.test(cleanPrompt);

    if (this.llm && (isAmbiguousOrShort || hasHistory) && cleanPrompt.length > 3) {
      try {
        const messagesToSend: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          {
            role: 'system',
            content: `Bạn là Chuyên gia Tối ưu hóa Truy vấn Pháp lý & Tài chính (Query Contextualizer & Rewrite Engine).
Nhiệm vụ: Phân tích lịch sử hội thoại (nếu có) và câu hỏi mới nhất của người dùng để biến câu hỏi nối tiếp/mơ hồ thành duy nhất 1 CÂU TRUY VẤN ĐỘC LẬP (Standalone Query) chứa đầy đủ ngữ cảnh để Vector Search tìm đúng văn bản.
Ví dụ:
- Lịch sử: User: "Điều 7 nói gì?" -> Bot: "Điều 7 quy định về đơn phương chấm dứt hợp đồng." | User: "thế bên B vi phạm cái đó thì sao?" -> Output: "Hậu quả và quyền xử lý của Bên A khi Bên B vi phạm quy định chấm dứt hợp đồng tại Điều 7"
- User: "Khi nào trả tiền?" -> Output: "Thời hạn và phương thức thanh toán trong hợp đồng"

BẮT BUỘC: Trả về duy nhất 1 câu truy vấn độc lập đã tối ưu. Không viết lời dẫn.`
          }
        ];

        if (hasHistory) {
          const recentHistory = history.slice(-4);
          for (const msg of recentHistory) {
            messagesToSend.push({ role: msg.role, content: msg.content });
          }
        }

        messagesToSend.push({ role: 'user', content: `CÂU HỎI MỚI NHẤT: ${cleanPrompt}` });

        const rewriteRes = await this.llm.generateText(messagesToSend, { task: 'SMALL_LLM', temperature: 0.1, max_tokens: 120 });

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


