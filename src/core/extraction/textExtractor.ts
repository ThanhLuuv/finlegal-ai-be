// Universal Document Text Extractor for PDF, TXT, CSV & Markdown

import { 
  extractTextFromPDFBuffer, 
  cleanPrintableText, 
  assessPageTextQuality 
} from '../../utils/pdfExtractor';

export interface ExtractedDocument {
  text: string;
  pageCount: number;
  extractionMethod: string;
}

export class UniversalTextExtractor {
  /**
   * Extracts text from binary document buffer according to file extension
   */
  public async extract(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (ext === 'pdf') {
      return await this.extractPdf(buffer);
    } else if (ext === 'txt' || ext === 'csv' || ext === 'md') {
      return this.extractText(buffer, ext);
    }

    throw new Error(`Định dạng tập tin .${ext} chưa được hỗ trợ.`);
  }

  private async extractPdf(buffer: ArrayBuffer): Promise<ExtractedDocument> {
    const rawText = await extractTextFromPDFBuffer(buffer);
    const cleanText = cleanPrintableText(rawText);

    if (!cleanText || cleanText.trim().length === 0) {
      return {
        text: `[File PDF (${buffer.byteLength} bytes) không trích xuất được text tự động]`,
        pageCount: 1,
        extractionMethod: 'pdf_parse_fallback'
      };
    }

    const pages = cleanText.split('\f');
    return {
      text: cleanText,
      pageCount: Math.max(1, pages.length),
      extractionMethod: 'pure_js_flatedecode_parser'
    };
  }

  private extractText(buffer: ArrayBuffer, ext: string): ExtractedDocument {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(buffer);
    const cleanText = cleanPrintableText(text);

    return {
      text: cleanText,
      pageCount: 1,
      extractionMethod: `${ext}_utf8_decoder`
    };
  }
}
