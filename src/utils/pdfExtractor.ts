// Comprehensive, pure JS FlateDecode PDF Text Extractor for Cloudflare Workers Environment

export function cleanPrintableText(text: string): string {
  if (!text) return '';
  // Remove binary control characters, replacement character (U+FFFD), and non-printable noise
  return text
    .replace(/[\x00-\x1F\x7F-\x9F\uFFFD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  } catch (e1) {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const response = new Response(ds.readable);
      const buf = await response.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e2) {
      return null;
    }
  }
}

function parseTextFromStreamString(rawString: string): string {
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

  const decompressedTextBlocks: string[] = [];

  // Find stream ... endstream positions
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
        const parsedText = parseTextFromStreamString(decompressedStr);
        if (parsedText && parsedText.length > 3) {
          decompressedTextBlocks.push(parsedText);
        }
      }
    }
  }

  if (decompressedTextBlocks.length > 0) {
    const fullText = decompressedTextBlocks.join('\n\n');
    return cleanPrintableText(fullText);
  }

  // Fallback: parse uncompressed text blocks
  const fallbackParsed = parseTextFromStreamString(fullLatin1Str);
  if (fallbackParsed.length > 10) {
    return cleanPrintableText(fallbackParsed);
  }

  // Ultimate Fallback: clean printable letters & numbers only from raw buffer
  return cleanPrintableText(fullLatin1Str);
}
