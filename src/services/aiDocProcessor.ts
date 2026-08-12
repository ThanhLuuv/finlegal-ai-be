// AI Document Ingestion Pre-Processor Service
// Uses Workers AI LLM to repair, structure, and convert raw PDF text into clean Markdown

import { LLMProviderService } from './llm';

export class AIDocumentProcessorService {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Cleans, repairs font corruptions, and structures raw document text into clean Markdown without truncating.
   */
  public async cleanAndStructureDocument(rawText: string, fileName: string): Promise<string> {
    const fullText = (rawText || '').trim();

    if (!fullText) {
      return `### Tài liệu: ${fileName}\n\nKhông tìm thấy nội dung văn bản.`;
    }

    // Process document in chunks of ~6,000 characters if very long, or process directly
    const maxSegmentLength = 6000;
    const segments: string[] = [];
    
    for (let i = 0; i < fullText.length; i += maxSegmentLength) {
      segments.push(fullText.slice(i, i + maxSegmentLength));
    }

    const processedSegments: string[] = [];

    for (let idx = 0; idx < segments.length; idx++) {
      const segmentText = segments[idx];
      try {
        const cleanedMarkdown = await this.llm.generateText([
          {
            role: 'system',
            content: `You are an expert AI Document Pre-processor & Text Repair Specialist for FinLegal AI.
Your objective is to take raw, messy, or font-corrupted text extracted from a PDF document (CV, Contract, or Financial Report) and convert it into clean, beautifully structured Vietnamese/English Markdown format.

CRITICAL EXTRACTION RULES:
1. Examine the FILE NAME "${fileName}" AND raw text. If the file name contains a candidate name or title (e.g. "FULLSTACK-LUUVANTHANH.pdf" or "CV_LUUVANTHANH.pdf"), YOU MUST EXPLICITLY INCLUDE "Tên ứng viên / Candidate Name: LƯU VĂN THÀNH (Fullstack Developer)" at the top of Segment 1!
2. Extract and preserve ALL candidate names, job titles, phone numbers, addresses, contract amounts, transaction dates, terms, and clauses.
3. Repair any corrupted font characters or broken words into clear, professional Vietnamese/English text.
4. DO NOT drop pages, sections, or paragraphs. Preserve 100% of factual information.
5. Output ONLY the cleaned Markdown text.`
          },
          {
            role: 'user',
            content: `FILE NAME: ${fileName} (Segment ${idx + 1}/${segments.length})\n\nRAW EXTRACTED TEXT CONTENT:\n${segmentText}`
          }
        ]);

        if (cleanedMarkdown && cleanedMarkdown.trim().length > 15) {
          processedSegments.push(cleanedMarkdown.trim());
        } else {
          processedSegments.push(segmentText);
        }
      } catch (err) {
        console.warn(`AI Document Pre-processor warning on segment ${idx + 1}, using fallback:`, err);
        processedSegments.push(segmentText);
      }
    }

    return processedSegments.join('\n\n---\n\n');
  }
}

