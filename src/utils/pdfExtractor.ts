// Comprehensive, pure JS FlateDecode, CMap & Hex Decoded PDF Text Extractor for Cloudflare Workers Environment

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\x00-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decodes raw PDF Hex strings like <362F3230323520852050726573656E74> into human readable text ("6/2025 – Present")
 */
export function decodeHexPDFString(hexStr: string): string {
  const cleanHex = hexStr.replace(/[^0-9A-Fa-f]/g, '');
  if (cleanHex.length < 2 || cleanHex.length % 2 !== 0) return '';
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  try {
    const decoded = new TextDecoder('utf-8').decode(bytes);
    if (decoded && cleanPrintableText(decoded).length > 0) return decoded;
  } catch {
    // fallback
  }
  try {
    return new TextDecoder('latin1').decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Strips raw PDF internal syntax objects (/Type /OutputIntent, endobj, /StructElem, ICC profiles)
 * and decodes embedded PDF hex text strings into clean text.
 */
export function stripPDFSyntaxNoise(text: string): string {
  if (!text) return '';

  // 1. Convert all embedded PDF hex strings <362F3230...> to readable text
  let result = text.replace(/<([0-9A-Fa-f]{4,})>/g, (fullMatch, hexStr) => {
    const decoded = decodeHexPDFString(hexStr);
    return decoded && decoded.trim().length > 0 ? ` ${decoded} ` : ' ';
  });

  // 2. Strip internal PDF structural operators, object tags, and CMap headers
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

/**
 * Detects if a chunk consists primarily of raw PDF syntax/CMap structural noise.
 */
export function isPDFSyntaxChunk(text: string): boolean {
  if (!text) return true;
  const upper = text.toUpperCase();
  const pdfKeywords = [
    'CIDFONTTYPE',
    'CIDTOGIDMAP',
    'CIDSYSTEMINFO',
    'OUTPUTINTENT',
    'STRUCTELEM',
    'ENDOBJ',
    'FONTDESCRIPTOR',
    'IDENTITY',
    'GTS_PDFA1',
    'SUBTYPE'
  ];
  let matchCount = 0;
  for (const kw of pdfKeywords) {
    if (upper.includes(kw)) matchCount++;
  }
  return matchCount >= 2 || upper.includes('CIDFONTTYPE2') || upper.includes('OUTPUTINTENT');
}


/**
 * Checks if extracted text is pure binary noise.
 */
export function isBinaryNoise(text: string): boolean {
  if (!text || text.trim().length < 4) return true;
  const validChars = text.match(/[A-Za-z0-9À-ỹ\s\.,:\-\(\)\/\$]/g) || [];
  const validRatio = validChars.length / text.length;
  return validRatio < 0.35;
}

/**
 * Parses ToUnicode CMap blocks in PDF to map glyph hex codes to UTF-8 characters
 */
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
    
    // Extract literal strings: (Hello World) Tj
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) {
        const cleaned = cleanPrintableText(tjMatch[1]);
        if (cleaned.length > 0) textBlocks.push(cleaned);
      }
    }

    // Extract hex strings with CMap decoding or direct hex decoding: <00010002> Tj
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

  return stripPDFSyntaxNoise(textBlocks.join(' '));
}

export async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8');
  const fullLatin1Str = latin1Decoder.decode(bytes);

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
        if (parsedText && parsedText.length > 3) {
          decompressedTextBlocks.push(parsedText);
        }
      }
    }

    searchPos = endStreamIdx + 9;
  }

  if (decompressedTextBlocks.length > 0) {
    const fullText = stripPDFSyntaxNoise(decompressedTextBlocks.join('\n\n'));
    if (fullText.length > 10 && !isBinaryNoise(fullText)) {
      return fullText;
    }
  }

  // 3. Fallback: parse uncompressed text blocks & decode embedded hex strings
  const fallbackParsed = stripPDFSyntaxNoise(parseTextFromStreamString(fullLatin1Str, globalCMap));
  if (fallbackParsed.length > 10 && !isBinaryNoise(fallbackParsed)) {
    return fallbackParsed;
  }

  // 4. Ultimate fallback: Extract printable word tokens and decode hex strings, filtering PDF syntax keywords
  const cleanedFullStr = stripPDFSyntaxNoise(fullLatin1Str);
  const pdfKeywords = new Set([
    'TYPE', 'OUTPUTINTENT', 'GTS_PDFA1', 'STRUCTELEM', 'ENDOBJ', 'OBJ', 'STREAM', 'ENDSTREAM',
    'CIDFONTTYPE', 'CIDFONTTYPE2', 'CIDTOGIDMAP', 'CIDSYSTEMINFO', 'IDENTITY', 'SUBTYPE',
    'FONTDESCRIPTOR', 'FONTFILE', 'FONTFILE2', 'FONTFILE3', 'PROCSET', 'MEDIABOX', 'CROPBOX',
    'RESOURCES', 'PARENT', 'KIDS', 'ROOT', 'INFO', 'TRANSPARENCY', 'COUNT', 'LAST', 'GROUP'
  ]);
  const wordTokens = (cleanedFullStr.match(/[A-Za-z0-9À-ỹ]{2,}/g) || [])
    .filter(token => !pdfKeywords.has(token.toUpperCase()));
  return wordTokens.join(' ');
}




