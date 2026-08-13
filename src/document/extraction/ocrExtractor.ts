// OCR Scanned Document Extractor (Interface & Fallback for Scanned PDFs)

import { RawExtractedDocument } from './pdfExtractor';

export class OcrDocumentExtractor {
  public async extractScanned(_buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    // Stop ingestion and throw explicit error when scanned PDF cannot be parsed via OCR
    throw new Error(`OCR_FAILED: File "${fileName}" là tập tin PDF dạng ảnh scan không chứa văn bản. Vui lòng chuyển đổi OCR trước khi tải lên.`);
  }
}

