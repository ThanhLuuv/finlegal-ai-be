// Standard PDF Text Extractor Engine

import { extractLegacyPdfText, stripPDFSyntaxNoise, cleanPrintableText } from './legacyPdfExtractor';

export interface ExtractedPage {
  pageNumber: number;
  content: string;
}

export interface RawExtractedDocument {
  text: string;
  pages: ExtractedPage[];
  pageCount: number;
  extractionMethod: string;
}

export class StandardPdfExtractor {
  public async extract(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const rawText = await extractLegacyPdfText(buffer);
    const cleaned = cleanPrintableText(stripPDFSyntaxNoise(rawText));

    // Approximate multi-page splitting based on page markers or length
    const pageLength = 3000;
    const pages: ExtractedPage[] = [];
    if (cleaned.length === 0) {
      pages.push({ pageNumber: 1, content: '' });
    } else {
      let pageNum = 1;
      for (let i = 0; i < cleaned.length; i += pageLength) {
        pages.push({
          pageNumber: pageNum++,
          content: cleaned.substring(i, i + pageLength)
        });
      }
    }

    return {
      text: cleaned,
      pages,
      pageCount: pages.length,
      extractionMethod: 'pdf_flatedecode_stream'
    };
  }
}
