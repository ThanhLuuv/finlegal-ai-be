// Unified Document Extractor Factory

import { StandardPdfExtractor, RawExtractedDocument } from './pdfExtractor';
import { OcrDocumentExtractor } from './ocrExtractor';

export interface IDocumentExtractor {
  extract(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument>;
}

export class DocumentExtractorFactory implements IDocumentExtractor {
  private pdfExtractor: StandardPdfExtractor;
  private ocrExtractor: OcrDocumentExtractor;

  constructor() {
    this.pdfExtractor = new StandardPdfExtractor();
    this.ocrExtractor = new OcrDocumentExtractor();
  }

  public async extract(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'pdf' || !ext) {
      const result = await this.pdfExtractor.extract(buffer, fileName);
      if (result.text && result.text.trim().length > 10) {
        return result;
      }
      // If PDF text extraction is empty, try OCR fallback
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
