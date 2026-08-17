// Universal Document Text Extractor for PDF, DOCX, TXT, CSV & Markdown (Flow §4 Dual-Tier Alignment)

import { unzipSync, strFromU8 } from 'fflate';
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
  private ai?: Ai;

  constructor(ai?: Ai) {
    this.ai = ai;
  }

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
   * Tier 1: Cloudflare Workers AI Vision OCR Fallback for complex layouts/scans/obfuscated fonts
   */
  private async extractPdf(buffer: ArrayBuffer): Promise<ExtractedDocument> {
    const rawText = await extractTextFromPDFBuffer(buffer);
    const cleanText = cleanPrintableText(rawText);
    const quality = assessPageTextQuality(cleanText, 1);

    if (cleanText && cleanText.trim().length > 0 && quality.isValid) {
      const pages = cleanText.split('\f');
      return {
        text: cleanText,
        pageCount: Math.max(1, pages.length),
        extractionMethod: 'tier2_flatedecode_fast'
      };
    }

    // Tier 1 Fallback: Call Cloudflare Workers AI Vision Model (@cf/moondream/moondream3.1-9B-A2B)
    if (this.ai) {
      const visionModels = [
        '@cf/moondream/moondream3.1-9B-A2B',
        '@cf/meta/llama-3.2-11b-vision-instruct'
      ];

      const uint8 = new Uint8Array(buffer.slice(0, 400000));
      const imageBytes = Array.from(uint8).map(b => Number(b));

      for (const visionModel of visionModels) {
        try {
          console.log(`[Vision AI Executing] Reading PDF layout & OCR via Vision Model: ${visionModel}...`);
          const response = await (this.ai as any).run(visionModel, {
            prompt: 'agree\nExtract ALL readable text from this document image in clean structured Markdown format. Include all headings, name, contact details, skills, work experience, projects, education.',
            image: imageBytes
          });

          const extractedText = typeof response === 'string' ? response : (response?.response || response?.description || response?.text || '');
          if (extractedText && extractedText.trim().length > 20) {
            return {
              text: extractedText.trim(),
              pageCount: 1,
              extractionMethod: `tier1_vision_ai_${visionModel}`
            };
          }
        } catch (visionErr) {
          console.warn(`Vision Model ${visionModel} notice:`, String(visionErr));
        }
      }
    }

    // Fallback: Extract clean natural language tokens if cleanText has any valid words
    const rawTokens = cleanText ? cleanText.match(/\b[A-Za-z0-9\u00C0-\u1EF9.,:\-@\/()]{3,}\b/g) || [] : [];
    const validTokens = rawTokens.filter(t => !/^(Adobe|UCS|Poppins|90KSX|github|itfoundry|wVw|xnx|zFz)$/i.test(t));
    const cleanTokens = validTokens.join(' ').trim();

    if (cleanTokens && cleanTokens.length > 30) {
      return {
        text: cleanTokens,
        pageCount: 1,
        extractionMethod: 'tier1_clean_tokens_fallback'
      };
    }

    return {
      text: `[Tài liệu PDF Scan / Bảng biểu phức tạp (${buffer.byteLength} bytes)]`,
      pageCount: 1,
      extractionMethod: 'tier1_fallback'
    };
  }

  /**
   * Structured Word (.docx) ZIP Decompressor & XML Parser (fflate)
   * Decompresses word/document.xml from DOCX zip archive and extracts paragraphs, headings, & tables
   */
  private extractDocx(buffer: ArrayBuffer): ExtractedDocument {
    try {
      const bytes = new Uint8Array(buffer);
      const unzipped = unzipSync(bytes);

      // Find word/document.xml in ZIP entries
      let documentXml: string | null = null;
      for (const key of Object.keys(unzipped)) {
        if (key.toLowerCase().endsWith('word/document.xml')) {
          documentXml = strFromU8(unzipped[key]);
          break;
        }
      }

      if (!documentXml) {
        for (const key of Object.keys(unzipped)) {
          if (key.endsWith('.xml') && key.includes('document')) {
            documentXml = strFromU8(unzipped[key]);
            break;
          }
        }
      }

      if (documentXml) {
        return this.parseDocxXml(documentXml, buffer.byteLength);
      }
    } catch (e) {
      console.error('fflate DOCX unzip error:', e);
    }

    // Fallback if unzipping failed
    const decoder = new TextDecoder('utf-8');
    const rawString = decoder.decode(buffer);
    return this.parseDocxXml(rawString, buffer.byteLength);
  }

  /**
   * Parses extracted word/document.xml into Markdown Text & Tables
   */
  private parseDocxXml(rawXml: string, byteLength: number): ExtractedDocument {
    const lines: string[] = [];

    // Step 1: Extract Tables (<w:tbl>) as Markdown Tables
    const tblRegex = /<w:tbl[\s\S]*?<\/w:tbl>/g;
    let tblMatch: RegExpExecArray | null;
    let processedRaw = rawXml;

    while ((tblMatch = tblRegex.exec(rawXml)) !== null) {
      const tblXml = tblMatch[0];
      const rows: string[][] = [];
      const trMatches = tblXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];

      for (const trXml of trMatches) {
        const tcMatches = trXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
        const rowCells: string[] = [];
        for (const tcXml of tcMatches) {
          const textRuns = tcXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
          const cellText = textRuns
            .map(t => t.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean)
            .join(' ');
          rowCells.push(cellText || ' ');
        }
        if (rowCells.length > 0) rows.push(rowCells);
      }

      if (rows.length > 0) {
        let mdTable = '\n';
        const colCount = Math.max(...rows.map(r => r.length));
        const headerRow = rows[0];
        mdTable += `| ${headerRow.join(' | ')} |\n`;
        mdTable += `| ${new Array(colCount).fill('---').join(' | ')} |\n`;
        for (let i = 1; i < rows.length; i++) {
          mdTable += `| ${rows[i].join(' | ')} |\n`;
        }
        mdTable += '\n';

        processedRaw = processedRaw.replace(tblXml, mdTable);
      }
    }

    // Step 2: Extract Paragraphs (<w:p>) with Heading levels
    const pMatches = processedRaw.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    for (const pXml of pMatches) {
      const styleMatch = pXml.match(/<w:pStyle w:val="([^"]+)"/);
      const styleVal = styleMatch ? styleMatch[1].toLowerCase() : '';

      let prefix = '';
      if (styleVal.includes('heading1') || styleVal.includes('title')) prefix = '# ';
      else if (styleVal.includes('heading2')) prefix = '## ';
      else if (styleVal.includes('heading3')) prefix = '### ';

      const textRuns = pXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      const pText = textRuns
        .map(t => t.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
        .join(' ');

      if (pText) {
        lines.push(`${prefix}${pText}`);
      }
    }

    // If paragraph matching returned empty, fallback to simple <w:t> run extraction
    if (lines.length === 0) {
      const matches = rawXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      for (const m of matches) {
        const clean = m.replace(/<[^>]+>/g, '').trim();
        if (clean) lines.push(clean);
      }
    }

    let text = lines.join('\n\n');
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    const cleanText = cleanPrintableText(text);

    if (!cleanText || cleanText.trim().length === 0) {
      return {
        text: `[Tài liệu Word DOCX (${byteLength} bytes)]`,
        pageCount: 1,
        extractionMethod: 'docx_xml_extractor_fallback'
      };
    }

    return {
      text: cleanText,
      pageCount: Math.max(1, Math.ceil(cleanText.length / 2500)),
      extractionMethod: 'docx_fflate_xml_parser'
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
