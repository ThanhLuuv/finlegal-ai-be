/**
 * Utility to generate a valid minimal PDF 1.4 ArrayBuffer from text content.
 * Ensures generated files (e.g. seed sample contract) have valid PDF magic bytes (%PDF-1.4)
 * and correct xref table structures for native browser PDF viewers.
 */
export function generatePdfBufferFromText(title: string, content: string): ArrayBuffer {
  const lines = content.split('\n');
  const pdfLines: string[] = [
    'BT',
    '/F1 11 Tf',
    '40 800 Td',
    '14 TL'
  ];

  for (const line of lines) {
    const escaped = line
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
    
    pdfLines.push(`(${escaped}) Tj`);
    pdfLines.push('T*');
  }
  pdfLines.push('ET');

  const streamContent = pdfLines.join('\n');
  const streamLength = new TextEncoder().encode(streamContent).byteLength;

  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const obj5 = `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`;

  const off1 = header.length;
  const off2 = off1 + obj1.length;
  const off3 = off2 + obj2.length;
  const off4 = off3 + obj3.length;
  const off5 = off4 + obj4.length;
  const xrefStart = off5 + obj5.length;

  const pad = (num: number) => num.toString().padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(off1)} 00000 n \n${pad(off2)} 00000 n \n${pad(off3)} 00000 n \n${pad(off4)} 00000 n \n${pad(off5)} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const fullPdfStr = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return new TextEncoder().encode(fullPdfStr).buffer as ArrayBuffer;
}

/**
 * Checks if a given ArrayBuffer contains valid PDF magic bytes (%PDF-) at the start.
 */
export function isValidPdfBuffer(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 5) return false;
  const bytes = new Uint8Array(buffer);
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  );
}
