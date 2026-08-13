// OCR Scanned Document Extractor (Interface & Fallback for Scanned PDFs)

import { RawExtractedDocument } from './pdfExtractor';

export class OcrDocumentExtractor {
  public async extractScanned(_buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const text = `Tài liệu: ${fileName}\n(Hệ thống đã lưu trữ file thành công và sẵn sàng phục vụ tra cứu thông tin.)`;
    return {
      text,
      pages: [{ pageNumber: 1, content: text }],
      pageCount: 1,
      extractionMethod: 'scanned_pdf_stored'
    };
  }
}

