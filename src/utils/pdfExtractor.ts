// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { cleanPrintableText, stripPDFSyntaxNoise, extractTextWithCMapDecompression } from './pdf/streamParser';
import { isCMapFontGarbage } from './pdf/qualityAssessor';

/**
 * Universal High-Precision PDF Text Extractor Entrypoint
 * Uses lightweight pure-JS CMap decompressor (zero heavy binary dependencies)
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Step 1: High-precision CMap & FlateDecode Stream Decompression
  const cmapText = extractTextWithCMapDecompression(buffer);
  if (cmapText && cmapText.length >= 20 && !isCMapFontGarbage(cmapText)) {
    console.log(`[PDF Extraction Success] CMap decompressor extracted ${cmapText.length} characters.`);
    return cmapText;
  }

  // Step 2: Fallback to standard TextDecoder PDF syntax parsing
  const decoder = new TextDecoder('utf-8');
  let rawStr = '';
  try { rawStr = decoder.decode(buffer); } catch {}

  const clean = cleanPrintableText(stripPDFSyntaxNoise(rawStr));

  if (!isCMapFontGarbage(clean) && clean.length >= 20) {
    return clean;
  }

  return '';
}
