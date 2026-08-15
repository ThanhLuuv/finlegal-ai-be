// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { cleanPrintableText, stripPDFSyntaxNoise } from './pdf/streamParser';
import { isCMapFontGarbage, assessPageTextQuality } from './pdf/qualityAssessor';

/**
 * Universal PDF Text Extractor Entrypoint
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let rawStr = '';
  try { rawStr = decoder.decode(buffer); } catch {}

  const clean = cleanPrintableText(stripPDFSyntaxNoise(rawStr));

  if (isCMapFontGarbage(clean)) {
    return '';
  }

  return clean;
}
