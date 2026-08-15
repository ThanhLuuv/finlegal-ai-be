// Pure JS FlateDecode & CMap Stream Parser (100% Workers V8 Isolate Compatible)

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

export function stripPDFSyntaxNoise(text: string): string {
  if (!text) return '';
  return text
    .replace(/\/Filter\s*\/FlateDecode/g, '')
    .replace(/\/CIDInit\s*\/ProcSet\s*findresource\s*begin/g, '')
    .replace(/endcmap\s*CMapName\s*currentdict\s*end/gi, '')
    .replace(/begincmap[\s\S]*?endcmap/gi, '')
    .replace(/endbfrange\s*endcmap/gi, '')
    .replace(/obj[\s\S]*?endobj/g, '')
    .replace(/<<[\s\S]*?>>/g, '')
    .replace(/stream[\s\S]*?endstream/gi, '')
    .replace(/%PDF-\d\.\d/g, '')
    .replace(/\b(BT|ET|Td|TD|Tj|TJ|cm|Tm|Do|gs|q|Q)\b/g, ' ')
    .trim();
}

export function isPDFSyntaxChunk(text: string): boolean {
  if (!text) return false;
  const syntaxTerms = ['FlateDecode', 'CIDInit', 'ProcSet', 'begincmap', 'endcmap', 'endbfrange', 'OutputIntents', 'CIDFontType2'];
  let count = 0;
  for (const term of syntaxTerms) {
    if (text.includes(term)) count++;
  }
  return count >= 2;
}
