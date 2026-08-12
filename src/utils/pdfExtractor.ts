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
 * Checks if extracted text is pure binary noise.
 */
export function isBinaryNoise(text: string): boolean {
  if (!text || text.trim().length < 4) return true;
  const validChars = text.match(/[A-Za-z0-9À-ỹ\s\.,:\-\(\)\/\$]/g) || [];
  const validRatio = validChars.length / text.length;
  return validRatio < 0.4;
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

  // Fast linear scanning for BT ... ET blocks without regex backtracking
  let pos = 0;
  while (pos < rawString.length) {
    const btIdx = rawString.indexOf('BT', pos);
    if (btIdx === -1) break;
    const etIdx = rawString.indexOf('ET', btIdx + 2);
    if (etIdx === -1) break;

    const block = rawString.substring(btIdx, etIdx + 2);
    
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
        const joined = strInside.map(s => s.slice(1, -1)).join(' ');
        const cleaned = cleanPrintableText(joined);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }

      const hexInside = inner.match(/<([0-9A-Fa-f\s]+)>/g);
      if (hexInside && cmap && cmap.size > 0) {
        let decodedStr = '';
        for (const h of hexInside) {
          const hexClean = h.slice(1, -1).replace(/\s+/g, '').toUpperCase();
          for (let i = 0; i < hexClean.length; i += 4) {
            const chunk = hexClean.substring(i, i + 4);
            decodedStr += cmap.get(chunk) || '';
          }
        }
        if (decodedStr.length > 0) textBlocks.push(decodedStr);
      }
    }

    pos = etIdx + 2;
  }

  return textBlocks.join(' ');
}

export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8');
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

  // 2. Find stream ... endstream positions via linear indexOf search (Zero Regex Backtracking)
  let searchPos = 0;
  while (searchPos < fullLatin1Str.length) {
    const streamIdx = fullLatin1Str.indexOf('stream', searchPos);
    if (streamIdx === -1) break;

    const endStreamIdx = fullLatin1Str.indexOf('endstream', streamIdx + 6);
    if (endStreamIdx === -1) break;

    let startOffset = streamIdx + 6;
    if (bytes[startOffset] === 13) startOffset++; // \r
    if (bytes[startOffset] === 10) startOffset++; // \n

    if (endStreamIdx > startOffset) {
      const streamBytes = bytes.subarray(startOffset, endStreamIdx);
      const decompressed = await decompressFlate(streamBytes);

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
        if (parsedText && parsedText.length > 3 && !isBinaryNoise(parsedText)) {
          decompressedTextBlocks.push(parsedText);
        }
      }
    }

    searchPos = endStreamIdx + 9;
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


