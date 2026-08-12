// OCR Scanned Document Extractor (Interface & Fallback for Scanned PDFs)

import { RawExtractedDocument } from './pdfExtractor';

export class OcrDocumentExtractor {
  public async extractScanned(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    // OCR Interface stub: Falls back gracefully if PDF contains image scans only
    return {
      text: `[Tài liệu Scan: ${fileName} - Cần OCR xử lý]`,
      pages: [{ pageNumber: 1, content: `[Scanned Document Page 1]` }],
      pageCount: 1,
      extractionMethod: 'ocr_fallback'
    };
  }
}
