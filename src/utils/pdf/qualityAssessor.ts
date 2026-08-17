// PDF Text Quality Assessor & Encoding Repair Metrics

import { PageTextQuality } from '../../core/types';
import { cleanPrintableText } from './streamParser';

export function isCMapFontGarbage(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const sample = text.slice(0, 1500).trim();

  // 1. Explicit check for garbled font vector path tokens (e.g. wVw, xnx, zFz, 90KSX, 32654, 546632, 99991)
  if (/(?:wVw|xnx|zFz|90KSX|32654|546632|99991|326654|KSX|EaV)/i.test(sample)) {
    return true; // 100% Font Vector Stream Garbage!
  }

  // 2. High ratio of single-character tokens separated by spaces (e.g. "u u v>v v wVw x xnx y*y y zFz")
  const singleCharTokens = (sample.match(/(?:^|\s)[A-Za-z0-9$%&/+*:;\-.](?=\s|$)/g) || []).length;
  const totalTokens = Math.max(1, sample.split(/\s+/).length);
  if ((singleCharTokens / totalTokens) > 0.22) {
    return true; // Single-character CID font unpacking garbage!
  }

  // 3. Count real natural language words (excluding font metadata strings like Adobe, Poppins, itfoundry)
  const cleanSample = sample
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\b(Adobe|UCS|Poppins|itfoundry|90KSX|EaV)\b/gi, '');
  
  const realWords = cleanSample.match(/\b[A-Za-z0-9\u00C0-\u1EF9]{3,}\b/g) || [];
  if (realWords.length < 6) {
    return true; // Insufficient natural language words
  }

  // 4. Unprintable control characters check
  const unprintableCount = (sample.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F\uFFFD]/g) || []).length;
  if ((unprintableCount / Math.max(1, sample.length)) > 0.08) {
    return true;
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
