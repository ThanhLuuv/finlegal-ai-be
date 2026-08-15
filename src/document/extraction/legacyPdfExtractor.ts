export { cleanPrintableText, decodeHexPDFString, stripPDFSyntaxNoise, isPDFSyntaxChunk, isBinaryNoise, isBinaryNoise as isCMapFontGarbage } from '../../utils/pdfExtractor';
import { extractTextFromPDFBuffer } from '../../utils/pdfExtractor';

export async function extractLegacyPdfText(buffer: ArrayBuffer): Promise<string> {
  return extractTextFromPDFBuffer(buffer);
}
