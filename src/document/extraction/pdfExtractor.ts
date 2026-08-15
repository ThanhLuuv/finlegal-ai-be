// Pure JS PDF Text Extractor (Zero Native Dependencies, Cloudflare Workers V8 Isolate Compatible)

import { 
  extractTextFromPDFBuffer, 
  stripPDFSyntaxNoise, 
  cleanPrintableText, 
  isPDFSyntaxChunk, 
  isBinaryNoise, 
  assessTextQuality 
} from '../../utils/pdfExtractor';

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
    const pages: ExtractedPage[] = [];

    // Pure JS FlateDecode & CMap Stream Parser (100% Workers V8 Isolate Compatible)
    const rawText = await extractTextFromPDFBuffer(buffer);
    const quality = assessTextQuality(rawText);

    if (!quality.isValid || !quality.repairedText || quality.repairedText.trim().length === 0) {
      return {
        text: '',
        pages: [{ pageNumber: 1, content: '' }],
        pageCount: 1,
        extractionMethod: 'pdf_extraction_failed'
      };
    }

    const cleanText = quality.repairedText;
    const rawPages = cleanText.split('\f');
    let pNum = 1;

    for (const rawP of rawPages) {
      const cleanP = cleanPrintableText(rawP.replace(/--- PAGE \d+ ---/g, ''));
      if (cleanP.length > 0) {
        pages.push({
          pageNumber: pNum++,
          content: cleanP
        });
      }
    }

    if (pages.length === 0) {
      pages.push({
        pageNumber: 1,
        content: cleanText
      });
    }

    return {
      text: cleanText,
      pages,
      pageCount: pages.length,
      extractionMethod: 'pure_js_flatedecode_parser'
    };
  }
}
