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
  if (upper.includes('%PDF-') || upper.includes('XREF') || upper.includes('TRAILER') || upper.includes('ENDOBJ') || upper.includes('ENDSTREAM')) {
    return true;
  }
  const pdfKeywords = [
    '%PDF-',
    'XREF',
    'TRAILER',
    'ENDOBJ',
    'ENDSTREAM',
    'CIDFONTTYPE',
    'CIDTOGIDMAP',
    'CIDSYSTEMINFO',
    'OUTPUTINTENT',
    'STRUCTELEM',
    'FONTDESCRIPTOR',
    'IDENTITY',
    'GTS_PDFA1',
    'SUBTYPE',
    'MEDIABOX',
    'CROPBOX',
    'PROCSET',
    '/TYPE /PAGES',
    '/TYPE /CATALOG',
    '/TYPE /FONT'
  ];
  let matchCount = 0;
  for (const kw of pdfKeywords) {
    if (upper.includes(kw)) matchCount++;
  }
  return matchCount >= 1;
}

const HUMAN_READABLE_TEXT_REGEX = /[A-Za-z0-9àáảãạâầấẩẫậnăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ\s\.,:\-\(\)\"\'\?\!\=\+]/g;

export function isCMapFontGarbage(text: string): boolean {
  if (!text || text.trim().length === 0) return true;

  if (isPDFSyntaxChunk(text)) return true;

  // 1. Unprintable control characters check
  const controlGarbage = text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g) || [];
  if (controlGarbage.length / text.length > 0.15) return true;

  // 2. Exact Vietnamese Unicode & English Alphanumeric & Punctuation ratio check
  const validReadableChars = text.match(HUMAN_READABLE_TEXT_REGEX) || [];
  const validRatio = validReadableChars.length / text.length;
  if (validRatio < 0.60) return true;

  return false;
}

export function isBinaryNoise(text: string): boolean {
  return isCMapFontGarbage(text);
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

import { extractTextFromPDFBuffer } from '../../utils/pdfExtractor';

export async function extractLegacyPdfText(buffer: ArrayBuffer): Promise<string> {
  return extractTextFromPDFBuffer(buffer);
}
