// Enterprise PDF Text Extractor & Encoding Quality Assessor for RAG Pipeline
import pdfParse from 'pdf-parse';
import { PageTextQuality } from '../document/types';

export interface TextQualityResult {
  isValid: boolean;
  score: number;
  reason?: string;
  repairedText?: string;
}

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\x00/g, '')
    .replace(/[\x01-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface TextQualityMetrics {
  printableRatio: number;
  replacementCharRatio: number;
  weirdSpacingRatio: number;
  singleCharTokenRatio: number;
  extractedChars: number;
  status: 'GOOD' | 'REPAIRABLE' | 'BAD';
}

export function assessPageTextQuality(pageText: string, pageNumber: number): PageTextQuality {
  if (!pageText || pageText.trim().length < 15) {
    return {
      pageNumber,
      printableRatio: 0,
      replacementCharRatio: 0,
      weirdSpacingRatio: 0,
      singleCharacterTokenRatio: 0,
      alphabeticRatio: 0,
      textDensity: 0,
      extractedCharacterCount: 0,
      isValid: false,
      score: 0,
      reason: 'Page text is empty or too short (<15 chars)'
    };
  }

  const rawLength = pageText.length;
  const printableMatches = pageText.match(/[\x20-\x7E\u00A0-\u024F\u1EA0-\u1EF9]/g) || [];
  const printableRatio = printableMatches.length / rawLength;

  const replacementMatches = pageText.match(/[\uFFFD]/g) || [];
  const replacementCharRatio = replacementMatches.length / rawLength;

  const tokens = pageText.split(/\s+/).filter(t => t.length > 0);
  const singleCharTokens = tokens.filter(t => t.length === 1 && /[a-zA-Zà-ỹ]/.test(t));
  const singleCharacterTokenRatio = tokens.length > 0 ? singleCharTokens.length / tokens.length : 0;

  const alphaMatches = pageText.match(/[a-zA-Zà-ỹ]/g) || [];
  const alphabeticRatio = alphaMatches.length / rawLength;

  const quality = assessTextQuality(pageText);

  return {
    pageNumber,
    printableRatio,
    replacementCharRatio,
    weirdSpacingRatio: singleCharacterTokenRatio > 0.3 ? 0.8 : 0.1,
    singleCharacterTokenRatio,
    alphabeticRatio,
    textDensity: rawLength / 1000,
    extractedCharacterCount: rawLength,
    isValid: quality.isValid,
    score: quality.score,
    reason: quality.reason
  };
}

/**
 * Composite Multi-Metric Encoding & Text Quality Assessor.
 * Evaluates replacement char density, CID unmapped codes, single character token spacing anomalies,
 * and PDF syntax leakage without rigid vowel ratio heuristics.
 */
export function assessTextQuality(text: string): TextQualityResult {
  if (!text || text.trim().length < 15) {
    return { isValid: false, score: 0, reason: 'Text is empty or too short (<15 chars)' };
  }

  const rawLength = text.length;

  // 1. Unmapped CID Font code check e.g. (cid:123)
  const cidMatches = text.match(/\(cid:\d+\)/gi) || [];
  if (cidMatches.length > 3 || (cidMatches.length * 8) / rawLength > 0.05) {
    return { isValid: false, score: 0.1, reason: `Contains ${cidMatches.length} unmapped CID font codes (cid:XX)` };
  }

  // 2. Replacement char \uFFFD & Control chars density check
  const replacementMatches = text.match(/[\uFFFD]/g) || [];
  const replacementRatio = replacementMatches.length / rawLength;
  if (replacementRatio > 0.03) {
    return { isValid: false, score: 0.15, reason: `High replacement char '' ratio (${(replacementRatio * 100).toFixed(1)}%)` };
  }

  const controlGarbage = text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g) || [];
  const controlRatio = controlGarbage.length / rawLength;
  if (controlRatio > 0.04) {
    return { isValid: false, score: 0.15, reason: `High density of control characters (${(controlRatio * 100).toFixed(1)}%)` };
  }

  // 3. PDF Internal Syntax Leakage
  const pdfSyntaxRegex = /\b(\d+\s+\d+\s+obj|endobj|stream|endstream|\/Type\s*\/|\/MediaBox|\/FontDescriptor|\/FlateDecode|\/OutputIntent|\/CIDFontType\d*|\/CIDToGIDMap|\/Group|\/ProcSet)\b/gi;
  const syntaxMatches = text.match(pdfSyntaxRegex) || [];
  if (syntaxMatches.length >= 2) {
    return { isValid: false, score: 0.2, reason: `Contains PDF internal syntax noise (${syntaxMatches.length} matches)` };
  }

  // 4. Single-character token ratio & Weird Spacing check (e.g. "C V _ L U U _ V A N")
  const tokens = text.split(/\s+/).filter(t => t.length > 0);
  const singleCharTokens = tokens.filter(t => t.length === 1 && /[a-zA-Zà-ỹ]/.test(t));
  const singleCharRatio = tokens.length > 0 ? singleCharTokens.length / tokens.length : 0;

  let repaired = text;
  let isRepairable = false;

  if (singleCharRatio > 0.35 || /\b[a-zA-Zà-ỹ]\s+[a-zA-Zà-ỹ]\s+[a-zA-Zà-ỹ]\b/.test(repaired)) {
    repaired = repaired.replace(/(?<=\b[a-zA-Zà-ỹ])\s+(?=[a-zA-Zà-ỹ]\b)/g, '');
    isRepairable = true;
  }

  // 5. Letter Density check
  const letterMatches = text.match(/[a-zA-Zà-ỹ0-9]/g) || [];
  if (letterMatches.length < 10) {
    return { isValid: false, score: 0.1, reason: `Very low printable letter count (${letterMatches.length} chars)` };
  }

  return {
    isValid: true,
    score: isRepairable ? 0.75 : 0.95,
    repairedText: repaired
  };
}

/**
 * Decodes raw PDF Hex strings like <362F323032352085205072657365E74> into human readable text
 */
export function decodeHexPDFString(hexStr: string): string {
  const cleanHex = hexStr.replace(/[^0-9A-Fa-f]/g, '');
  if (cleanHex.length < 2) return '';

  if (cleanHex.length % 4 === 0) {
    let utf16Str = '';
    for (let i = 0; i < cleanHex.length; i += 4) {
      const code = parseInt(cleanHex.substring(i, i + 4), 16);
      if (!isNaN(code) && code > 0 && code !== 65535) {
        utf16Str += String.fromCharCode(code);
      }
    }
    const cleanUtf16 = cleanPrintableText(utf16Str);
    if (cleanUtf16.length > 0 && !isPDFSyntaxChunk(cleanUtf16)) {
      return cleanUtf16;
    }
  }

  if (cleanHex.length % 2 === 0) {
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }
    try {
      const decoded = new TextDecoder('utf-8').decode(bytes);
      const cleanUtf8 = cleanPrintableText(decoded);
      if (cleanUtf8.length > 0 && !isPDFSyntaxChunk(cleanUtf8)) return cleanUtf8;
    } catch {}
    try {
      const latin1 = new TextDecoder('latin1').decode(bytes);
      const cleanLatin1 = cleanPrintableText(latin1);
      if (cleanLatin1.length > 0 && !isPDFSyntaxChunk(cleanLatin1)) return cleanLatin1;
    } catch {}
  }

  return '';
}

/**
 * Strips raw PDF internal syntax objects and decodes embedded PDF hex text strings.
 */
export function stripPDFSyntaxNoise(text: string): string {
  if (!text) return '';

  let result = text.replace(/<([0-9A-Fa-f]{4,})>/g, (fullMatch, hexStr) => {
    const decoded = decodeHexPDFString(hexStr);
    return decoded && decoded.trim().length > 0 ? ` ${decoded} ` : ' ';
  });

  result = result
    .replace(/\/Type\s*\/[A-Za-z0-9]+/gi, ' ')
    .replace(/\/StructElem|\/OutputIntent|\/GTS_[A-Za-z0-9]+|\/Group|\/Transparency|\/Font|\/ProcSet|\/MediaBox|\/CropBox|\/Resources|\/Parent|\/Kids|\/Root|\/Info|\/FontDescriptor|\/FontFile\d*/gi, ' ')
    .replace(/\bSubtype\b|\bCIDFontType\d*\b|\bCIDToGIDMap\b|\bCIDSystemInfo\b|\bIdentity\b/gi, ' ')
    .replace(/\b\d+\s+\d+\s+obj\b/gi, ' ')
    .replace(/\bendobj\b/gi, ' ')
    .replace(/\/P\s+\d+\s+\d+\s+R/gi, ' ')
    .replace(/\/Last\s+\d+\s+\d+\s+R/gi, ' ')
    .replace(/\/F\d+\s+\d+\s+\d+\s+R/gi, ' ')
    .replace(/\/Count\s+\d+/gi, ' ')
    .replace(/\/T\s+|\/E\s+|\/S\s+|\/V\s+/gi, ' ')
    .replace(/XYZ\s+[^\s]+\s+[^\s]+\s+[^\s]+/gi, ' ')
    .replace(/endstream/gi, ' ')
    .replace(/stream/gi, ' ')
    .replace(/<<[\s\S]*?>>/g, ' ')
    .replace(/[\/\\\{\}\<\>\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return result;
}

export function isPDFSyntaxChunk(text: string): boolean {
  if (!text) return true;
  const upper = text.toUpperCase();
  if (upper.includes('%PDF-') || upper.includes('XREF 1') || upper.includes('TRAILER <<')) {
    return true;
  }
  const pdfKeywords = [
    '%PDF-', 'CIDFONTTYPE', 'CIDTOGIDMAP', 'CIDSYSTEMINFO', 'OUTPUTINTENT',
    'STRUCTELEM', 'FONTDESCRIPTOR', 'GTS_PDFA1', '/TYPE /PAGES', '/TYPE /CATALOG', '/TYPE /FONT'
  ];
  let matchCount = 0;
  for (const kw of pdfKeywords) {
    if (upper.includes(kw)) matchCount++;
  }
  return matchCount >= 2;
}

export function isBinaryNoise(text: string): boolean {
  const quality = assessTextQuality(text);
  return !quality.isValid;
}

function parseCMap(cmapStr: string): Map<string, string> {
  const map = new Map<string, string>();
  
  const bfcharRegex = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = bfcharRegex.exec(cmapStr)) !== null) {
    const code = match[1].toUpperCase();
    const targetHex = match[2];
    let decodedStr = '';
    for (let i = 0; i < targetHex.length; i += 4) {
      const charCode = parseInt(targetHex.substring(i, i + 4), 16);
      if (!isNaN(charCode) && charCode > 0) {
        decodedStr += String.fromCharCode(charCode);
      }
    }
    if (decodedStr) map.set(code, decodedStr);
  }

  const bfrangeRegex = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
  while ((match = bfrangeRegex.exec(cmapStr)) !== null) {
    const startCode = parseInt(match[1], 16);
    const endCode = parseInt(match[2], 16);
    let targetCode = parseInt(match[3], 16);
    const hexLen = match[1].length;

    for (let c = startCode; c <= endCode; c++) {
      const hexKey = c.toString(16).padStart(hexLen, '0').toUpperCase();
      map.set(hexKey, String.fromCharCode(targetCode++));
    }
  }

  return map;
}

async function decompressFlate(bytes: Uint8Array): Promise<Uint8Array | null> {
  let dataToDecompress = bytes;
  if (bytes.length > 2 && bytes[0] === 0x78) {
    dataToDecompress = bytes.subarray(2);
  }

  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(dataToDecompress);
    writer.close();
    const response = new Response(ds.readable);
    const buf = await response.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const response = new Response(ds.readable);
      const buf = await response.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
}

function parseTextFromStreamString(rawString: string, cmap?: Map<string, string>): string {
  const textBlocks: string[] = [];

  let pos = 0;
  while (pos < rawString.length) {
    const btIdx = rawString.indexOf('BT', pos);
    if (btIdx === -1) break;
    const etIdx = rawString.indexOf('ET', btIdx + 2);
    if (etIdx === -1) break;

    const block = rawString.substring(btIdx, etIdx + 2);
    
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) {
        const cleaned = cleanPrintableText(tjMatch[1]);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }
    }

    const hexTjRegex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let hexTjMatch: RegExpExecArray | null;
    while ((hexTjMatch = hexTjRegex.exec(block)) !== null) {
      const hexStr = hexTjMatch[1].replace(/\s+/g, '').toUpperCase();
      if (cmap && cmap.size > 0) {
        let decoded = '';
        for (let i = 0; i < hexStr.length; i += 4) {
          const chunk = hexStr.substring(i, i + 4);
          decoded += cmap.get(chunk) || '';
        }
        if (decoded.length > 0) textBlocks.push(decoded);
      } else {
        const decodedDirect = decodeHexPDFString(hexStr);
        if (decodedDirect.length > 0) {
          textBlocks.push(decodedDirect);
        }
      }
    }

    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrayMatch[1];
      const strInside = inner.match(/\(([\s\S]*?)\)/g);
      if (strInside) {
        const joined = strInside.map(s => s.slice(1, -1)).join(' ');
        const cleaned = cleanPrintableText(joined);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }

      const hexInside = inner.match(/<([0-9A-Fa-f\s]+)>/g);
      if (hexInside) {
        for (const h of hexInside) {
          const hexClean = h.slice(1, -1).replace(/\s+/g, '').toUpperCase();
          if (cmap && cmap.size > 0) {
            let decodedStr = '';
            for (let i = 0; i < hexClean.length; i += 4) {
              const chunk = hexClean.substring(i, i + 4);
              decodedStr += cmap.get(chunk) || '';
            }
            if (decodedStr.length > 0) textBlocks.push(decodedStr);
          } else {
            const decodedDirect = decodeHexPDFString(hexClean);
            if (decodedDirect.length > 0) textBlocks.push(decodedDirect);
          }
        }
      }
    }

    pos = etIdx + 2;
  }

  // Fallback: If no BT...ET blocks yielded text, search the entire stream for literal strings (...) and hex strings <...>
  if (textBlocks.length === 0) {
    const directStrRegex = /\(([\s\S]*?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = directStrRegex.exec(rawString)) !== null) {
      if (match[1] && match[1].length > 1) {
        const cleaned = cleanPrintableText(match[1]);
        if (cleaned.length > 0 && !isPDFSyntaxChunk(cleaned)) {
          textBlocks.push(cleaned);
        }
      }
    }

    const directHexRegex = /<([0-9A-Fa-f\s]{4,})>/g;
    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = directHexRegex.exec(rawString)) !== null) {
      const hexClean = hexMatch[1].replace(/\s+/g, '').toUpperCase();
      if (cmap && cmap.size > 0) {
        let decodedStr = '';
        for (let i = 0; i < hexClean.length; i += 4) {
          const chunk = hexClean.substring(i, i + 4);
          decodedStr += cmap.get(chunk) || '';
        }
        if (decodedStr.length > 0) textBlocks.push(decodedStr);
      } else {
        const decodedDirect = decodeHexPDFString(hexClean);
        if (decodedDirect.length > 0) textBlocks.push(decodedDirect);
      }
    }
  }

  return stripPDFSyntaxNoise(textBlocks.join(' '));
}

/**
 * Pure JS FlateDecode & CMap Stream Parser Fallback
 */
export async function extractTextFromPDFBufferLegacy(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8');
  const fullLatin1Str = latin1Decoder.decode(bytes);

  let globalCMap: Map<string, string> | undefined;
  if (fullLatin1Str.includes('beginbfrange') || fullLatin1Str.includes('beginbfchar')) {
    globalCMap = parseCMap(fullLatin1Str);
  }

  const decompressedTextBlocks: string[] = [];
  let searchPos = 0;

  while (searchPos < fullLatin1Str.length) {
    const streamIdx = fullLatin1Str.indexOf('stream', searchPos);
    if (streamIdx === -1) break;

    const endStreamIdx = fullLatin1Str.indexOf('endstream', streamIdx + 6);
    if (endStreamIdx === -1) break;

    let startOffset = streamIdx + 6;
    if (bytes[startOffset] === 13) startOffset++;
    if (bytes[startOffset] === 10) startOffset++;

    if (endStreamIdx > startOffset) {
      const streamBytes = bytes.subarray(startOffset, endStreamIdx);
      let decompressed = await decompressFlate(streamBytes);
      if (!decompressed || decompressed.length === 0) {
        decompressed = streamBytes;
      }

      if (decompressed && decompressed.length > 0) {
        let decompressedStr = '';
        try {
          decompressedStr = utf8Decoder.decode(decompressed);
        } catch {
          decompressedStr = latin1Decoder.decode(decompressed);
        }

        let streamCMap = globalCMap;
        if (decompressedStr.includes('beginbfrange') || decompressedStr.includes('beginbfchar')) {
          streamCMap = parseCMap(decompressedStr);
        }

        const parsedText = parseTextFromStreamString(decompressedStr, streamCMap);
        if (parsedText && parsedText.length > 3) {
          decompressedTextBlocks.push(parsedText);
        }
      }
    }

    searchPos = endStreamIdx + 9;
  }

  if (decompressedTextBlocks.length > 0) {
    const fullText = stripPDFSyntaxNoise(decompressedTextBlocks.join('\n\n'));
    const qual = assessTextQuality(fullText);
    if (qual.repairedText && qual.repairedText.trim().length > 15) {
      return qual.repairedText;
    }
    if (fullText.trim().length > 15) {
      return fullText;
    }
  }

  const fallbackParsed = stripPDFSyntaxNoise(parseTextFromStreamString(fullLatin1Str, globalCMap));
  const fallbackQual = assessTextQuality(fallbackParsed);
  if (fallbackQual.repairedText && fallbackQual.repairedText.trim().length > 15) {
    return fallbackQual.repairedText;
  }
  if (fallbackParsed.trim().length > 15) {
    return fallbackParsed;
  }

  return '';
}

/**
 * Universal PDF Text Extractor (Tier 1: pdf-parse Engine -> Tier 2: Pure JS FlateDecode Fallback)
 */
export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  // Tier 1: Try pdf-parse (Mozilla pdfjs-dist engine) if environment supports dynamic require
  try {
    const nodeBuf = new Uint8Array(buffer);
    const pdfData = await pdfParse(nodeBuf);
    if (pdfData && pdfData.text) {
      const cleaned = cleanPrintableText(pdfData.text);
      const quality = assessTextQuality(cleaned);
      if (quality.repairedText && quality.repairedText.trim().length > 15) {
        return quality.repairedText;
      }
    }
  } catch {
    // Dynamic require of pdf.js is not supported in Cloudflare Workers isolate - fall through to Tier 2 Pure JS
  }

  // Tier 2: Pure JS FlateDecode & CMap Stream Parser (Zero native dependencies)
  try {
    const legacyText = await extractTextFromPDFBufferLegacy(buffer);
    if (legacyText && legacyText.trim().length > 15) {
      return legacyText;
    }
  } catch (legacyErr) {
    console.warn('[PDF Extractor] Legacy FlateDecode stream extractor notice:', legacyErr);
  }

  return '';
}

/**
 * Extracts embedded JPEG images from a scanned PDF buffer.
 */
export function extractEmbeddedImagesFromPDF(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const images: string[] = [];
  let i = 0;
  
  while (i < bytes.length - 3 && images.length < 5) {
    // Check for JPEG SOI marker: 0xFF 0xD8 0xFF
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      const start = i;
      let j = i + 2;
      let end = -1;
      
      // Find JPEG EOI marker: 0xFF 0xD9
      while (j < bytes.length - 1) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
          end = j + 2;
          break;
        }
        j++;
      }
      
      if (end > start && (end - start) > 2000) { // Only images > 2KB
        const imgBytes = bytes.subarray(start, end);
        const b64 = arrayBufferToBase64(imgBytes);
        images.push(`data:image/jpeg;base64,${b64}`);
        i = end;
        continue;
      }
    }
    i++;
  }
  
  return images;
}
