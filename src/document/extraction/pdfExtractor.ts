import pdfParse from 'pdf-parse';
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

    // Tier 1: Primary Extraction using pdf-parse with custom page boundary renderer
    try {
      const nodeBuf = new Uint8Array(buffer);
      const pdfData = await pdfParse(nodeBuf, {
        pagerender: async function(pageData: any) {
          const textContent = await pageData.getTextContent();
          let lastY: number | undefined;
          let text = '';
          for (const item of textContent.items) {
            if (lastY === item.transform[5] || lastY === undefined) {
              text += item.str + ' ';
            } else {
              text += '\n' + item.str + ' ';
            }
            lastY = item.transform[5];
          }
          return `\n\n\f--- PAGE ${pageData.pageIndex + 1} ---\n\n` + text;
        }
      });

      if (pdfData && pdfData.text) {
        const fullText = pdfData.text;
        const quality = assessTextQuality(fullText);

        if (quality.isValid && quality.repairedText) {
          const rawPages = fullText.split('\f');
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

          if (pages.length > 0) {
            return {
              text: quality.repairedText,
              pages,
              pageCount: pages.length,
              extractionMethod: 'pdf_parse_mozilla_engine'
            };
          }
        }
      }
    } catch (err) {
      console.warn('[StandardPdfExtractor] pdf-parse primary engine notice:', err);
    }

    // Tier 2: Fall back to extractTextFromPDFBuffer
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

    const cleaned = quality.repairedText;

    if (rawText.includes('\f')) {
      const rawPages = rawText.split('\f');
      let pageNum = 1;
      for (const pText of rawPages) {
        const cleanP = cleanPrintableText(pText);
        if (cleanP.length > 0) {
          pages.push({
            pageNumber: pageNum++,
            content: cleanP
          });
        }
      }
    }

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
