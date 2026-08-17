// PDF Text Quality Assessor & Encoding Repair Metrics

import { PageTextQuality } from '../../core/types';
import { cleanPrintableText } from './streamParser';

export function isCMapFontGarbage(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const sample = text.slice(0, 1000).trim();
  const len = Math.max(1, sample.length);

  // 1. Unprintable control characters
  const unprintableCount = (sample.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F\uFFFD]/g) || []).length;
  if ((unprintableCount / len) > 0.10) return true;

  // 2. High ratio of special non-alphanumeric symbols (e.g. $ % & / + * : ; ' ")
  const symbolCount = (sample.match(/[$%&/+*:;'"\\=<>~`#@^_{}\[\]|]/g) || []).length;
  if ((symbolCount / len) > 0.20) return true;

  // 3. High ratio of single-character tokens separated by spaces (e.g. "2 8 7 0 6 . / / 6")
  const singleCharTokens = (sample.match(/(?:^|\s)[A-Za-z0-9$%&/+*:;\-.](?=\s|$)/g) || []).length;
  if ((singleCharTokens / Math.max(1, sample.split(/\s+/).length)) > 0.35) return true;

  // 4. Count real readable words (>= 2 letters/alphanumeric with Vietnamese accents)
  const realWordsCount = (sample.match(/\b[A-Za-z0-9\u00C0-\u1EF9]{2,}\b/g) || []).length;
  if (len >= 40 && realWordsCount < 4) return true;

  // 5. Vowel ratio check for natural language text (English & Vietnamese)
  const vowelCount = (sample.match(/[aeiouyAEIOUYàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/g) || []).length;
  const letterCount = (sample.match(/[a-zA-Z\u00C0-\u1EF9]/g) || []).length;
  if (letterCount >= 25 && (vowelCount / letterCount) < 0.18) {
    return true; // Garbled font vector tokens without real natural language words!
  }

  // 6. Check for obscure non-Latin/IPA/Combining diacritics mixed into text (e.g. ͂0, ׇ;, Ή3, ʋ0, ʍ1, Ώ6, ֑?, ɖ4, Ҟ@, ǥ8, ³8, ѹJ, 6ζ)
  const obscureSymbols = (sample.match(/[\u0250-\u036F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u1D00-\u1EFF]/g) || []).length;
  if (obscureSymbols >= 3) {
    return true; // Garbled CID font vector mapping!
  }

  return false;
}

export function assessPageTextQuality(pageText: string, pageNumber: number): PageTextQuality {
  if (!pageText || pageText.trim().length < 15) {
    return {
      pageNumber,
      printableRatio: 0,
      replacementCharRatio: 0,
      weirdSpacingRatio: 0,
      singleCharacterTokenRatio: 0,
      alphabeticRatio: 0,
      textDensity: 0,
      extractedCharacterCount: 0,
      isValid: false,
      score: 0,
      reason: 'Page text is empty or too short (<15 chars)'
    };
  }

  const clean = cleanPrintableText(pageText);
  const isGarbage = isCMapFontGarbage(clean);

  return {
    pageNumber,
    printableRatio: isGarbage ? 0.2 : 0.95,
    replacementCharRatio: 0,
    weirdSpacingRatio: 0,
    singleCharacterTokenRatio: 0,
    alphabeticRatio: isGarbage ? 0.3 : 0.9,
    textDensity: clean.length,
    extractedCharacterCount: clean.length,
    isValid: !isGarbage,
    score: isGarbage ? 20 : 95
  };
}

/**
 * Quality Gate Evaluator for PDF Ingestion (Flow §4 Quality Gate)
 */
export function isPDFTextQualityAcceptable(text: string): { acceptable: boolean; score: number; reason?: string } {
  if (!text || text.trim().length < 50) {
    return { acceptable: false, score: 0, reason: 'Text is empty or too short (<50 chars)' };
  }

  const quality = assessPageTextQuality(text, 1);
  if (!quality.isValid || quality.score < 70) {
    return { acceptable: false, score: quality.score, reason: 'Quality score below 70 threshold (Scan/Corrupt Stream)' };
  }

  return { acceptable: true, score: quality.score };
}
