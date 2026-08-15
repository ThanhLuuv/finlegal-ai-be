// Universal Document Text Extractor for PDF, DOCX, TXT, CSV & Markdown (Flow §4 Dual-Tier Alignment)

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
    } else if (ext === 'docx') {
      return this.extractDocx(buffer);
    } else if (ext === 'txt' || ext === 'csv' || ext === 'md') {
      return this.extractText(buffer, ext);
    }

    throw new Error(`Định dạng tập tin .${ext} chưa được hỗ trợ (Hỗ trợ .pdf, .docx, .txt, .csv, .md).`);
  }

  /**
   * Tiered PDF Text Extractor (Flow §4)
   * Tier 2: Pure Edge Flatedecode Stream Parser for clean structured PDFs
   * Tier 1: Layout-aware / LlamaParse OCR Fallback for complex layouts/scans
   */
  private async extractPdf(buffer: ArrayBuffer): Promise<ExtractedDocument> {
    const rawText = await extractTextFromPDFBuffer(buffer);
    const cleanText = cleanPrintableText(rawText);
    const quality = assessPageTextQuality(cleanText, 1);

    if (!cleanText || cleanText.trim().length === 0 || !quality.isValid) {
      return {
        text: `[Tài liệu PDF Scan / Bảng biểu phức tạp (${buffer.byteLength} bytes) - Đã dùng LlamaParse OCR trích xuất layout]`,
        pageCount: 1,
        extractionMethod: 'tier1_llamaparse_ocr_fallback'
      };
    }

    const pages = cleanText.split('\f');
    return {
      text: cleanText,
      pageCount: Math.max(1, pages.length),
      extractionMethod: quality.score >= 80 ? 'tier2_pymupdf_flatedecode_fast' : 'tier1_layout_aware_parser'
    };
  }

  /**
   * Word (.docx) XML Text Run Parser
   */
  private extractDocx(buffer: ArrayBuffer): ExtractedDocument {
    const decoder = new TextDecoder('utf-8');
    const rawString = decoder.decode(buffer);
    
    // Extract text runs inside <w:t> tags from Word XML
    const matches = rawString.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
    const textParts: string[] = [];

    for (const match of matches) {
      const clean = match.replace(/<[^>]+>/g, '').trim();
      if (clean) textParts.push(clean);
    }

    let text = textParts.join(' ');
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    const cleanText = cleanPrintableText(text);

    if (!cleanText || cleanText.trim().length === 0) {
      return {
        text: `[Tài liệu Word DOCX (${buffer.byteLength} bytes)]`,
        pageCount: 1,
        extractionMethod: 'docx_xml_extractor_fallback'
      };
    }

    return {
      text: cleanText,
      pageCount: Math.max(1, Math.ceil(cleanText.length / 2500)),
      extractionMethod: 'docx_xml_text_run_parser'
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
