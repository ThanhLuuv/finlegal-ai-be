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
   * Leverages AgentRouter (gpt-5.6-sol / claude-opus-4-6) for high-precision document structuring.
   */
  public async cleanAndStructureDocument(rawText: string, fileName: string): Promise<string> {
    const fullText = (rawText || '').trim();

    if (!fullText) {
      return `### Tài liệu: ${fileName}\n\nKhông tìm thấy nội dung văn bản.`;
    }

    const sampleHeader = fullText.slice(0, 10000);

    try {
      const cleanedHeader = await this.llm.generateText([
        {
          role: 'system',
          content: `You are an expert AI Document Pre-processor for FinLegal AI.
Your task is to take raw extracted text from a document (CV, contract, or legal report) and format it into clean, beautifully structured Vietnamese/English Markdown.
Rules:
1. Preserve 100% of candidate names, phone numbers, email addresses, job titles, experience dates, project descriptions, skills, and contract clauses.
2. Remove any remaining raw PDF binary code or font syntax noise (like CIDFontType, OutputIntent, endobj).
3. Do NOT invent information. Respond only with the cleaned document content in Markdown.`
        },
        {
          role: 'user',
          content: `DOCUMENT FILE NAME: ${fileName}\n\nRAW EXTRACTED TEXT:\n${sampleHeader}`
        }
      ], { max_tokens: 2048 });

      if (cleanedHeader && cleanedHeader.trim().length > 15) {
        if (fullText.length > 10000) {
          return `${cleanedHeader.trim()}\n\n${fullText.slice(10000)}`;
        }
        return cleanedHeader.trim();
      }
    } catch (err) {
      console.warn('AI Document Pre-processor AgentRouter pass notice:', err);
    }

    return `### Tài liệu: ${fileName}\n\n${fullText}`;
  }
}



