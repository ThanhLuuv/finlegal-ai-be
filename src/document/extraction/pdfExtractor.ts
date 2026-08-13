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

    const pages: ExtractedPage[] = [];

    if (!cleaned || cleaned.trim().length === 0) {
      pages.push({ pageNumber: 1, content: '' });
      return {
        text: '',
        pages,
        pageCount: 1,
        extractionMethod: 'pdf_flatedecode_stream'
      };
    }

    // Preserve physical page breaks if FormFeed \f markers exist
    if (rawText.includes('\f')) {
      const rawPages = rawText.split('\f');
      let pageNum = 1;
      for (const pText of rawPages) {
        const cleanP = cleanPrintableText(stripPDFSyntaxNoise(pText));
        if (cleanP.length > 0) {
          pages.push({
            pageNumber: pageNum++,
            content: cleanP
          });
        }
      }
    }

    // Fallback: If no \f formfeed markers were found, split by page markers or paragraph blocks
    if (pages.length === 0) {
      const paragraphBlocks = cleaned.split(/\n{2,}/);
      let currentPageText = '';
      let pageNum = 1;
      const TARGET_PAGE_CHARS = 2200;

      for (const block of paragraphBlocks) {
        if (currentPageText.length + block.length > TARGET_PAGE_CHARS && currentPageText.length > 0) {
          pages.push({
            pageNumber: pageNum++,
            content: currentPageText.trim()
          });
          currentPageText = block + '\n\n';
        } else {
          currentPageText += block + '\n\n';
        }
      }

      if (currentPageText.trim().length > 0) {
        pages.push({
          pageNumber: pageNum,
          content: currentPageText.trim()
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

