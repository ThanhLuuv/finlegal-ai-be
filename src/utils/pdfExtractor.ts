// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { cleanPrintableText, stripPDFSyntaxNoise, extractTextWithCMapDecompression } from './pdf/streamParser';
import { isCMapFontGarbage, assessPageTextQuality } from './pdf/qualityAssessor';

import { extractText } from 'unpdf';

/**
 * Universal High-Precision PDF Text Extractor Entrypoint
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Step 1: Try unpdf (Edge-native Mozilla PDF.js Parser) for 100% font/layout precision
  try {
    const { text, totalPages } = await extractText(buffer);
    if (text && Array.isArray(text)) {
      const fullPdfText = text.join('\n\n\f\n\n').trim();
      const cleaned = cleanPrintableText(fullPdfText);
      if (cleaned && cleaned.length >= 20 && !isCMapFontGarbage(cleaned)) {
        return cleaned;
      }
    } else if (typeof text === 'string' && (text as string).trim().length >= 20) {
      const cleaned = cleanPrintableText(text);
      if (!isCMapFontGarbage(cleaned)) {
        return cleaned;
      }
    }
  } catch (unpdfErr) {
    console.warn('unpdf extraction notice, attempting stream parser fallback:', unpdfErr);
  }

  // Step 2: Try high-precision CMap & FlateDecode Stream Decompression
  const cmapText = extractTextWithCMapDecompression(buffer);
  if (cmapText && cmapText.length >= 20 && !isCMapFontGarbage(cmapText)) {
    return cmapText;
  }

  // Step 3: Fallback to standard TextDecoder PDF syntax parsing
  const decoder = new TextDecoder('utf-8');
  let rawStr = '';
  try { rawStr = decoder.decode(buffer); } catch {}

  const clean = cleanPrintableText(stripPDFSyntaxNoise(rawStr));

  if (isCMapFontGarbage(clean)) {
    return '';
  }

  return clean;
}
