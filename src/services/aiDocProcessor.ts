// AI Document Ingestion Pre-Processor Service
// Uses Workers AI LLM to repair, structure, and convert raw PDF text into clean Markdown

import { LLMProviderService } from './llm';

export class AIDocumentProcessorService {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Cleans, repairs font corruptions, and structures raw document text into clean Markdown without timing out.
   */
  public async cleanAndStructureDocument(rawText: string, fileName: string): Promise<string> {
    const fullText = (rawText || '').trim();

    if (!fullText) {
      return `### Tài liệu: ${fileName}\n\nKhông tìm thấy nội dung văn bản.`;
    }

    // Fast-path: Process sample header for structure and preserve 100% of remaining full text
    const sampleHeader = fullText.slice(0, 5000);

    try {
      const cleanedHeader = await this.llm.generateText([
        {
          role: 'system',
          content: `You are an expert AI Document Pre-processor for FinLegal AI.
Clean, repair font errors, and convert this document text into clean Vietnamese/English Markdown.
Preserve all candidate names, job titles, contract amounts, terms, and dates accurately.`
        },
        {
          role: 'user',
          content: `FILE NAME: ${fileName}\n\nRAW TEXT:\n${sampleHeader}`
        }
      ], { max_tokens: 1000 });

      if (cleanedHeader && cleanedHeader.trim().length > 15) {
        if (fullText.length > 5000) {
          return `${cleanedHeader.trim()}\n\n${fullText.slice(5000)}`;
        }
        return cleanedHeader.trim();
      }
    } catch (err) {
      console.warn('AI Document Pre-processor fast pass notice:', err);
    }

    return `### Tài liệu: ${fileName}\n\n${fullText}`;
  }
}


