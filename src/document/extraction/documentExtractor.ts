// Unified Document Extractor Factory (Standard PDF -> CMap Font Check -> Multimodal AI Vision -> AI Text Restoration -> OCR Fallback)

import { StandardPdfExtractor, RawExtractedDocument } from './pdfExtractor';
import { OcrDocumentExtractor } from './ocrExtractor';
import { assessTextQuality } from '../../utils/pdfExtractor';
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
    this.ocrExtractor = new OcrDocumentExtractor(llm);
    this.llm = llm;
  }

  public async extract(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'pdf' || !ext) {
      // 1. Tier 1: Try Standard PDF Extraction (pdf-parse Mozilla engine + FlateDecode)
      const result = await this.pdfExtractor.extract(buffer, fileName);
      const quality = assessTextQuality(result.text);

      if (quality.isValid && quality.repairedText) {
        // Optional AI Text Restoration to fix minor formatting/spacing anomalies
        let finalContent = quality.repairedText;
        if (this.llm && finalContent.length > 50) {
          try {
            finalContent = await this.llm.normalizeAndRepairDocumentText(finalContent, fileName);
          } catch (repairErr) {
            console.warn('[DocumentExtractorFactory] AI Normalizer notice:', repairErr);
          }
        }

        return {
          text: finalContent,
          pages: result.pages.length > 0 ? result.pages : [{ pageNumber: 1, content: finalContent }],
          pageCount: result.pageCount || 1,
          extractionMethod: result.extractionMethod
        };
      }

      console.warn(`[DocumentExtractorFactory] Standard PDF extraction returned garbled/invalid text (${quality.reason}). Escalating to Multimodal Vision AI...`);

      // 2. Tier 2: Escalated Multimodal Vision AI Document Reader
      if (this.llm) {
        try {
          const aiText = await this.llm.processMultimodalDocument(buffer, fileName);
          if (aiText) {
            const aiQuality = assessTextQuality(aiText);
            if (aiQuality.isValid && aiQuality.repairedText) {
              return {
                text: aiQuality.repairedText,
                pages: [{ pageNumber: 1, content: aiQuality.repairedText }],
                pageCount: 1,
                extractionMethod: 'multimodal_ai_vision'
              };
            }
          }
        } catch (err) {
          console.warn('[DocumentExtractorFactory] Multimodal AI Vision extraction fallback notice:', err);
        }
      }

      // 3. Tier 3: OCR Scanner Extractor Fallback
      return await this.ocrExtractor.extractScanned(buffer, fileName);
    }

    // Default plain text decoder for .txt / .csv
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
