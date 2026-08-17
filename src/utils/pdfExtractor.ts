// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { cleanPrintableText, stripPDFSyntaxNoise, extractTextWithCMapDecompression } from './pdf/streamParser';
import { isCMapFontGarbage } from './pdf/qualityAssessor';


/**
 * Universal High-Precision PDF Text Extractor Entrypoint
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Step 1: Try high-precision CMap & FlateDecode Stream Decompression (With Fallback to Parenthesized Text & Binary Tokens)
  const cmapText = extractTextWithCMapDecompression(buffer);
  if (cmapText && cmapText.length >= 20 && !isCMapFontGarbage(cmapText)) {
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

  // Step 3: Return raw extracted stream text if any
  return cmapText || clean || '';
}
