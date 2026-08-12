// Legacy Pure-JS FlateDecode Stream & Hex PDF Extractor
// $O(N)$ Linear Search for Cloudflare Workers Environment

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\x00-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

export function isBinaryNoise(text: string): boolean {
  if (!text || text.trim().length < 4) return true;
  const validChars = text.match(/[A-Za-z0-9À-ỹ\s\.,:\-\(\)\/\$]/g) || [];
  const validRatio = validChars.length / text.length;
  return validRatio < 0.35;
}

async function decompressFlate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();

    const response = new Response(ds.readable);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();

      const response = new Response(ds.readable);
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }
}

export async function extractLegacyPdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin1Decoder = new TextDecoder('latin1');
  const utf8Decoder = new TextDecoder('utf-8');
  const fullLatin1Str = latin1Decoder.decode(bytes);

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
      const decompressed = await decompressFlate(streamBytes);

      if (decompressed && decompressed.length > 0) {
        let decompressedStr = '';
        try {
          decompressedStr = utf8Decoder.decode(decompressed);
        } catch {
          decompressedStr = latin1Decoder.decode(decompressed);
        }

        const strInside = decompressedStr.match(/\(([^)]+)\)/g);
        if (strInside) {
          const joined = strInside.map(s => s.slice(1, -1)).join(' ');
          const cleaned = cleanPrintableText(joined);
          if (cleaned.length > 0) decompressedTextBlocks.push(cleaned);
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
