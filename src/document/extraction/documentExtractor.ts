// Unified Document Extractor Factory (Standard PDF -> CMap Font Check -> Multimodal AI -> OCR Fallback)

import { StandardPdfExtractor, RawExtractedDocument } from './pdfExtractor';
import { OcrDocumentExtractor } from './ocrExtractor';
import { isCMapFontGarbage, isBinaryNoise } from './legacyPdfExtractor';
import { LLMProviderService } from '../../services/llm';

export interface IDocumentExtractor {
  extract(buffer: ArrayBuffer, fileName: string, llm?: LLMProviderService): Promise<RawExtractedDocument>;
}

export class DocumentExtractorFactory implements IDocumentExtractor {
  private pdfExtractor: StandardPdfExtractor;
  private ocrExtractor: OcrDocumentExtractor;
  private llm?: LLMProviderService;

  constructor(llm?: LLMProviderService) {
    this.pdfExtractor = new StandardPdfExtractor();
    this.ocrExtractor = new OcrDocumentExtractor();
    this.llm = llm;
  }

  public async extract(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'pdf' || !ext) {
      // 1. Try Standard PDF Extraction
      const result = await this.pdfExtractor.extract(buffer, fileName);
      
      if (result.text && result.text.trim().length > 10) {
        return result;
      }

      // 2. If PDF contains CMap font garbage or is empty, try Multimodal AI Document Processing
      if (this.llm) {
        try {
          const aiText = await this.llm.processMultimodalDocument(buffer, fileName);
          if (aiText && aiText.trim().length > 20 && !isCMapFontGarbage(aiText)) {
            return {
              text: aiText,
              pages: [{ pageNumber: 1, content: aiText }],
              pageCount: 1,
              extractionMethod: 'multimodal_ai_vision'
            };
          }
        } catch (err) {
          console.warn('Multimodal AI extraction fallback failed:', err);
        }
      }

      // 3. Fallback to OCR Scanner Extractor
      return await this.ocrExtractor.extractScanned(buffer, fileName);
    }

    // Default plain text decoder
    const textDecoder = new TextDecoder('utf-8');
    const text = textDecoder.decode(buffer);
    return {
      text,
      pages: [{ pageNumber: 1, content: text }],
      pageCount: 1,
      extractionMethod: 'plain_text_decoder'
    };
  }
}
