// PDF Text Extraction & Encoding Quality Utilities

export * from './pdf/streamParser';
export * from './pdf/qualityAssessor';

import { definePDFJSModule, extractText, getDocumentProxy } from 'unpdf';
// @ts-ignore
import * as pdfjs from 'unpdf/pdfjs';
import { cleanPrintableText, stripPDFSyntaxNoise, extractTextWithCMapDecompression } from './pdf/streamParser';
import { isCMapFontGarbage } from './pdf/qualityAssessor';

// Polyfill Promise.withResolvers for Cloudflare Workers runtime
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Bind PDFJS statically to avoid dynamic chunk loading in Workers
try {
  definePDFJSModule(async () => pdfjs as any);
} catch (e) {
  console.warn('PDFJS define module notice:', e);
}

/**
 * Universal High-Precision PDF Text Extractor Entrypoint
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);

  // Step 1: Use modern unpdf (Mozilla PDF.js Edge WASM engine) for standard font CMap & ToUnicode decoding
  try {
    const pdf = await getDocumentProxy(bytes);
    const unpdfResult = await extractText(pdf, { mergePages: true });
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

  // Step 2: Try pdf-parse as direct robust edge fallback
  try {
    const pdfParseModule: any = await import('pdf-parse');
    const pdfParse = pdfParseModule.default || pdfParseModule;
    if (typeof pdfParse === 'function') {
      const dataBuffer = (globalThis as any).Buffer ? (globalThis as any).Buffer.from(buffer) : new Uint8Array(buffer);
      const parsed = await pdfParse(dataBuffer);
      if (parsed && parsed.text && parsed.text.trim().length >= 20) {
        const clean = cleanPrintableText(parsed.text);
        if (!isCMapFontGarbage(clean) && clean.length >= 20) {
          console.log(`[PDF Extraction Success] pdf-parse extracted ${clean.length} characters.`);
          return clean;
        }
      }
    }
  } catch (parseErr) {
    console.warn('[PDF Extraction Notice] pdf-parse fallback notice:', parseErr);
  }

  // Step 3: Try high-precision CMap & FlateDecode Stream Decompression
  const cmapText = extractTextWithCMapDecompression(buffer);
  if (cmapText && cmapText.length >= 20 && !isCMapFontGarbage(cmapText)) {
    return cmapText;
  }

  // Step 4: Fallback to standard TextDecoder PDF syntax parsing
  const decoder = new TextDecoder('utf-8');
  let rawStr = '';
  try { rawStr = decoder.decode(buffer); } catch {}

  const clean = cleanPrintableText(stripPDFSyntaxNoise(rawStr));

  if (!isCMapFontGarbage(clean) && clean.length >= 20) {
    return clean;
  }

  // Step 5: Return empty if only garbage was detected so caller can trigger Vision OCR fallback
  return '';
}
