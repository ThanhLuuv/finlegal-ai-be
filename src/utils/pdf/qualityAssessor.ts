// PDF Text Quality Assessor & Encoding Repair Metrics

import { PageTextQuality } from '../../core/types';
import { cleanPrintableText } from './streamParser';

export function isCMapFontGarbage(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 1000);
  const unprintableCount = (sample.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F\uFFFD]/g) || []).length;
  
  // If sample contains 10+ real readable words (>=3 chars), it is 100% valid text
  const realWordsCount = (sample.match(/\b[A-Za-z0-9\u00C0-\u1EF9]{3,}\b/g) || []).length;
  if (realWordsCount >= 10 && unprintableCount < 10) {
    return false;
  }

  const singleCharCount = (sample.match(/\b[A-Za-z0-9]\b/g) || []).length;
  return (unprintableCount / Math.max(1, sample.length)) > 0.15 || (singleCharCount / Math.max(1, sample.length)) > 0.45;
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
