// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { extractText } from 'unpdf';
import { cleanPrintableText, stripPDFSyntaxNoise, extractTextWithCMapDecompression } from './pdf/streamParser';
import { isCMapFontGarbage } from './pdf/qualityAssessor';

/**
 * Universal High-Precision PDF Text Extractor Entrypoint
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Step 1: Use modern unpdf (Mozilla PDF.js Edge engine) for standard font CMap & ToUnicode decoding
  try {
    const unpdfResult = await extractText(new Uint8Array(buffer), { mergePages: true });
    if (unpdfResult && unpdfResult.text && typeof unpdfResult.text === 'string' && unpdfResult.text.trim().length >= 20) {
      const clean = cleanPrintableText(unpdfResult.text);
      if (!isCMapFontGarbage(clean) && clean.length >= 20) {
        console.log(`[PDF Extraction Success] unpdf extracted ${clean.length} characters with CMap resolution.`);
        return clean;
      }
    }
  } catch (err) {
    console.warn('[PDF Extraction Notice] unpdf parser notice:', err);
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

  if (!isCMapFontGarbage(clean) && clean.length >= 20) {
    return clean;
  }

  // Step 4: Return empty if only garbage was detected so caller can trigger Vision OCR fallback
  return '';
}
