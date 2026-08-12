// Lightweight, pure JS PDF Text Extractor for Cloudflare Workers Environment

export function extractTextFromPDFBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const textDecoder = new TextDecoder('latin1');
  const rawString = textDecoder.decode(bytes);

  const textBlocks: string[] = [];

  // 1. Extract BT ... ET blocks (PDF Text Object streams)
  const btRegex = /BT[\s\S]*?ET/g;
  let match: RegExpExecArray | null;

  while ((match = btRegex.exec(rawString)) !== null) {
    const block = match[0];
    
    // Extract strings inside Tj operator: (Hello World) Tj
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) textBlocks.push(tjMatch[1]);
    }

    // Extract array strings inside TJ operator: [(Hello) -10 (World)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrayMatch[1];
      const strInside = inner.match(/\(([\s\S]*?)\)/g);
      if (strInside) {
        textBlocks.push(strInside.map(s => s.slice(1, -1)).join(''));
      }
    }
  }

  const extracted = textBlocks
    .join(' ')
    .replace(/\\\( /g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\s+/g, ' ')
    .trim();

  if (extracted.length > 20) {
    return extracted;
  }

  // 2. Fallback: Clean readable text strings from raw buffer
  const cleanedRaw = rawString
    .replace(/stream[\s\S]*?endstream/g, ' ')
    .replace(/obj[\s\S]*?endobj/g, ' ')
    .replace(/<[0-9A-Fa-f]+>/g, ' ')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanedRaw.length > 0 ? cleanedRaw : rawString;
}
