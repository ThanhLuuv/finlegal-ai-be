// Comprehensive, pure JS FlateDecode & CMap PDF Text Extractor for Cloudflare Workers Environment

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  // Remove binary control characters, replacement character (U+FFFD), and non-printable noise
  return text
    .replace(/[\x00-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if extracted text is binary noise (like "u F r M Y U L = D 1 g R")
 */
export function isBinaryNoise(text: string): boolean {
  if (!text || text.length < 5) return true;
  
  // Count real words with length >= 2 vs single letter noise
  const realWords = text.match(/[A-Za-z0-9À-ỹ]{2,}/g) || [];
  const singleLetters = text.match(/\b[A-Za-z0-9]\b/g) || [];
  
  if (realWords.length < 3 || singleLetters.length > realWords.length * 1.2) {
    return true;
  }
  return false;
}

/**
 * Parses ToUnicode CMap blocks in PDF to map glyph hex codes to UTF-8 characters
 */
function parseCMap(cmapStr: string): Map<string, string> {
  const map = new Map<string, string>();
  
  // Match bfchar mappings: <0001> <004C>
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

  // Match bfrange mappings: <0001> <0005> <0041>
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
  const btRegex = /BT[\s\S]*?ET/g;
  let match: RegExpExecArray | null;

  while ((match = btRegex.exec(rawString)) !== null) {
    const block = match[0];
    
    // Extract literal strings: (Hello World) Tj
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) {
        const cleaned = cleanPrintableText(tjMatch[1]);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }
    }

    // Extract hex strings with CMap decoding: <00010002> Tj
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
        const cleaned = cleanPrintableText(hexStr);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }
    }

    // Extract array strings: [(Hello) -10 (World)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrayMatch[1];
      const strInside = inner.match(/\(([\s\S]*?)\)/g);
      if (strInside) {
        const joined = strInside.map(s => s.slice(1, -1)).join('');
        const cleaned = cleanPrintableText(joined);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }
    }
  }

  return textBlocks.join(' ');
}

export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const fullLatin1Str = latin1Decoder.decode(bytes);

  // Extract all valid words >= 2 chars directly from PDF buffer
  const wordTokens = fullLatin1Str.match(/[A-Za-z0-9À-ỹ]{2,}/g) || [];
  const validWordsText = wordTokens.join(' ');

  // 1. Scan for ToUnicode CMap blocks
  let globalCMap: Map<string, string> | undefined;
  if (fullLatin1Str.includes('beginbfrange') || fullLatin1Str.includes('beginbfchar')) {
    globalCMap = parseCMap(fullLatin1Str);
  }

  const decompressedTextBlocks: string[] = [];

  // 2. Find stream ... endstream positions and decompress FlateStreams
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(fullLatin1Str)) !== null) {
    const streamContentStart = streamMatch.index + streamMatch[0].indexOf('stream') + 6;
    let startOffset = streamContentStart;
    if (bytes[startOffset] === 13) startOffset++; // \r
    if (bytes[startOffset] === 10) startOffset++; // \n

    const endOffset = streamMatch.index + streamMatch[0].lastIndexOf('endstream');
    if (endOffset > startOffset) {
      const streamBytes = bytes.subarray(startOffset, endOffset);
      const decompressed = await decompressFlate(streamBytes);

      if (decompressed && decompressed.length > 0) {
        const decompressedStr = latin1Decoder.decode(decompressed);
        
        let streamCMap = globalCMap;
        if (decompressedStr.includes('beginbfrange') || decompressedStr.includes('beginbfchar')) {
          streamCMap = parseCMap(decompressedStr);
        }

        const parsedText = parseTextFromStreamString(decompressedStr, streamCMap);
        if (parsedText && parsedText.length > 3 && !isBinaryNoise(parsedText)) {
          decompressedTextBlocks.push(parsedText);
        }
      }
    }
  }

  if (decompressedTextBlocks.length > 0) {
    const fullText = decompressedTextBlocks.join('\n\n');
    const cleaned = cleanPrintableText(fullText);
    if (!isBinaryNoise(cleaned)) return cleaned;
  }

  // 3. Fallback: parse uncompressed text blocks
  const fallbackParsed = parseTextFromStreamString(fullLatin1Str, globalCMap);
  if (!isBinaryNoise(fallbackParsed)) {
    return cleanPrintableText(fallbackParsed);
  }

  // 4. Return valid words text from PDF buffer
  return validWordsText.length > 10 ? validWordsText : cleanPrintableText(fullLatin1Str);
}
