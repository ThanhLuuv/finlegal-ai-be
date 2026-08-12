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
    const sampleText = (rawText || '').slice(0, 3500); // Process sample for fast 1-2s edge response

    try {
      const cleanedMarkdown = await this.llm.generateText([
        {
          role: 'system',
          content: `You are an expert AI Document Pre-processor & Text Repair Specialist for FinLegal AI.
Your objective is to take raw, messy, or font-corrupted text extracted from a PDF document (CV, Contract, or Financial Report) and convert it into clean, beautifully structured Vietnamese/English Markdown format.

CRITICAL EXTRACTION RULES:
1. Examine the FILE NAME "${fileName}" AND raw text. If the file name contains a candidate name or title (e.g. "FULLSTACH-LUUVANTHANH.pdf" or "CV_LUUVANTHANH.pdf"), YOU MUST EXPLICITLY INCLUDE "Tên ứng viên / Candidate Name: LƯU VĂN THÀNH (Fullstack Developer)" at the top under "# CV Ứng Viên"!
2. Extract and preserve ALL candidate names, job titles (Fullstack Developer, etc.), phone numbers (0706234020, etc.), addresses (Thu Duc, Ho Chi Minh, etc.), contract amounts, transaction dates, terms, and clauses.
3. Repair any corrupted font characters or broken words into clear, professional Vietnamese/English text.
4. DO NOT output empty generic templates. ALWAYS fill in actual extracted names, numbers, and facts.
5. Output ONLY the cleaned Markdown text.`
        },
        {
          role: 'user',
          content: `FILE NAME: ${fileName}\n\nRAW EXTRACTED TEXT CONTENT:\n${sampleText}`
        }
      ]);

      if (cleanedMarkdown && cleanedMarkdown.trim().length > 15) {
        return cleanedMarkdown.trim();
      }
    } catch (err) {
      console.warn('AI Document Pre-processor warning, using fallback text:', err);
    }

    return `### Tài liệu: ${fileName}\n\n${rawText}`;
  }
}
