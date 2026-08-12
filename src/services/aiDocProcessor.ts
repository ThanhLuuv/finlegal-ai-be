// AI Document Ingestion Pre-Processor Service
// Uses Workers AI LLM to repair, structure, and convert raw PDF text into clean Markdown

import { LLMProviderService } from './llm';

export class AIDocumentProcessorService {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Cleans, repairs font corruptions, and structures raw document text into clean Markdown.
   */
  public async cleanAndStructureDocument(rawText: string, fileName: string): Promise<string> {
    if (!rawText || rawText.trim().length === 0) {
      return `### Tài liệu: ${fileName}\n\n(Nội dung văn bản rỗng).`;
    }

    const sampleText = rawText.slice(0, 3500); // Process sample for fast 1-2s edge response

    try {
      const cleanedMarkdown = await this.llm.generateText([
        {
          role: 'system',
          content: `You are an expert AI Document Pre-processor & Text Repair Specialist for FinLegal AI.
Your objective is to take raw, messy, or font-corrupted text extracted from a PDF document (CV, Contract, or Financial Report) and convert it into clean, beautifully structured Vietnamese/English Markdown format.

RULES:
1. Extract and preserve ALL candidate names, job titles, phone numbers, addresses, contract amounts, transaction dates, terms, and clauses.
2. Repair any corrupted font characters or broken words into clear, professional text.
3. Organize the output into clear Markdown headings (e.g., # Hợp Đồng / # CV Ứng Viên, ## Thông Tin Liên Hệ, ## Kinh Nghiệm Làm Việc / ## Điều Khoản Thanh Toán).
4. Output ONLY the cleaned Markdown text. Do NOT add conversational filler like "Here is the cleaned markdown".`
        },
        {
          role: 'user',
          content: `FILE NAME: ${fileName}\n\nRAW EXTRACTED TEXT:\n${sampleText}`
        }
      ]);

      if (cleanedMarkdown && cleanedMarkdown.trim().length > 15) {
        return cleanedMarkdown.trim();
      }
    } catch (err) {
      console.warn('AI Document Pre-processor warning, using fallback text:', err);
    }

    return rawText;
  }
}
