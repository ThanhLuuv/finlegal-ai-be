// Comprehensive, pure JS PDF Text & Hex Extractor for Cloudflare Workers Environment

function decodeHexPDFString(hex: string): string {
  const cleanHex = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (cleanHex.length === 0 || cleanHex.length % 2 !== 0) return '';
  
  // Check if UTF-16BE BOM (FEFF)
  if (cleanHex.startsWith('FEFF') || cleanHex.startsWith('feff')) {
    let str = '';
    for (let i = 4; i < cleanHex.length; i += 4) {
      const code = parseInt(cleanHex.substring(i, i + 4), 16);
      if (!isNaN(code) && code > 0) str += String.fromCharCode(code);
    }
    return str;
  }

  // Standard ASCII / UTF-8 byte stream
  let str = '';
  for (let i = 0; i < cleanHex.length; i += 2) {
    const code = parseInt(cleanHex.substring(i, i + 2), 16);
    if (!isNaN(code) && code >= 32 && code <= 255) {
      str += String.fromCharCode(code);
    }
  }
  return str;
}

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
    
    // Extract literal strings: (Hello World) Tj
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) textBlocks.push(tjMatch[1]);
    }

    // Extract hex strings: <00480065006C006C006F> Tj
    const hexTjRegex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let hexTjMatch: RegExpExecArray | null;
    while ((hexTjMatch = hexTjRegex.exec(block)) !== null) {
      const decoded = decodeHexPDFString(hexTjMatch[1]);
      if (decoded) textBlocks.push(decoded);
    }

    // Extract array strings: [(Hello) -10 (World)] TJ or [<0048> -10 <0065>] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrayMatch[1];
      
      // Match literal strings (xxx)
      const strInside = inner.match(/\(([\s\S]*?)\)/g);
      if (strInside) {
        textBlocks.push(strInside.map(s => s.slice(1, -1)).join(''));
      }

      // Match hex strings <xxx>
      const hexInside = inner.match(/<[0-9A-Fa-f\s]+>/g);
      if (hexInside) {
        const decodedHexArray = hexInside.map(h => decodeHexPDFString(h.slice(1, -1))).join('');
        if (decodedHexArray) textBlocks.push(decodedHexArray);
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

  // 2. Fallback: Clean printable text strings from raw buffer
  const cleanedRaw = rawString
    .replace(/stream[\s\S]*?endstream/g, ' ')
    .replace(/obj[\s\S]*?endobj/g, ' ')
    .replace(/<[0-9A-Fa-f]+>/g, ' ')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanedRaw.length > 0 ? cleanedRaw : rawString;
}
