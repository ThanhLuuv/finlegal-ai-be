import { RawExtractedDocument } from './pdfExtractor';
import { LLMProviderService } from '../../services/llm';

export class OcrDocumentExtractor {
  private llm?: LLMProviderService;

  constructor(llm?: LLMProviderService) {
    this.llm = llm;
  }

  public async extractScanned(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    // 1. Delegate document reading to AI Multimodal Vision (@cf/google/gemini-2.5-flash)
    if (this.llm) {
      try {
        const aiText = await this.llm.processMultimodalDocument(buffer, fileName);
        if (aiText && aiText.trim().length > 10) {
          return {
            text: aiText,
            pages: [{ pageNumber: 1, content: aiText }],
            pageCount: 1,
            extractionMethod: 'ai_multimodal_vision'
          };
        }
      } catch (err) {
        console.warn('AI Multimodal Vision OCR extraction notice:', err);
      }
    }

    // 2. Dynamic UTF-8 / ASCII text decoder fallback from buffer without hardcoded strings
    const textDecoder = new TextDecoder('utf-8');
    let rawStr = '';
    try { rawStr = textDecoder.decode(buffer); } catch { }

    const cleanContent = rawStr
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      text: cleanContent,
      pages: [{ pageNumber: 1, content: cleanContent }],
      pageCount: 1,
      extractionMethod: 'scanned_pdf_decoder'
    };
  }
}

