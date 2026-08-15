import { RawExtractedDocument } from './pdfExtractor';
import { LLMProviderService } from '../../services/llm';
import { isCMapFontGarbage, isPDFSyntaxChunk, stripPDFSyntaxNoise, cleanPrintableText } from './legacyPdfExtractor';

export class OcrDocumentExtractor {
  private llm?: LLMProviderService;

  constructor(llm?: LLMProviderService) {
    this.llm = llm;
  }

  public async extractScanned(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    // 1. Delegate document reading to AI Multimodal Vision
    if (this.llm) {
      try {
        const aiText = await this.llm.processMultimodalDocument(buffer, fileName);
        if (aiText && aiText.trim().length > 10 && !isCMapFontGarbage(aiText) && !isPDFSyntaxChunk(aiText)) {
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

    // 2. Dynamic text decoder fallback - ensure PDF binary syntax noise is stripped
    const textDecoder = new TextDecoder('utf-8');
    let rawStr = '';
    try { rawStr = textDecoder.decode(buffer); } catch { }

    const cleanContent = cleanPrintableText(stripPDFSyntaxNoise(rawStr));

    const finalContent = (isPDFSyntaxChunk(cleanContent) || isCMapFontGarbage(cleanContent))
      ? `[Tài liệu PDF (${fileName}) chứa dữ liệu mã hóa hoặc ảnh quét. Cần xem lại định dạng file.]`
      : cleanContent;

    return {
      text: finalContent,
      pages: [{ pageNumber: 1, content: finalContent }],
      pageCount: 1,
      extractionMethod: 'scanned_pdf_decoder'
    };
  }
}

