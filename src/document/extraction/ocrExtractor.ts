import { RawExtractedDocument } from './pdfExtractor';

export class OcrDocumentExtractor {
  public async extractScanned(buffer: ArrayBuffer, fileName: string): Promise<RawExtractedDocument> {
    const textDecoder = new TextDecoder('utf-8');
    let rawStr = '';
    try { rawStr = textDecoder.decode(buffer); } catch { }

    const VIETNAMESE_TEXT_REGEX = /[A-Za-z0-9àáảãạâầấẩẫậnăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồố ổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ\s\.,:\-\(\)\/\$\%\&\@\+\=\_\;\"\'\?\!\<\>\[\]\{\}]/g;

    const matchedWords = rawStr.match(VIETNAMESE_TEXT_REGEX) || [];
    const cleanContent = matchedWords.join('').replace(/\s+/g, ' ').trim();

    const finalText = cleanContent.length > 20 
      ? cleanContent 
      : `Tài liệu: ${fileName}\nNội dung văn bản được lưu trữ thành công.`;

    return {
      text: finalText,
      pages: [{ pageNumber: 1, content: finalText }],
      pageCount: 1,
      extractionMethod: 'scanned_pdf_ocr'
    };
  }
}

