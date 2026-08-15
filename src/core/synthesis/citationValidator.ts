import { Citation } from '../types';

export interface FormattedSourceLocation {
  displayLabel: string;
  documentName: string;
  sourceType: string;
  sectionTitle?: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface VerifiedCitationResult {
  answer: string;
  citedEvidences: Citation[];
  formattedSources: FormattedSourceLocation[];
  hasInvalidCitations: boolean;
  warnings: string[];
}

export class CitationValidator {
  /**
   * Formats a generic Citation into a clean, human-readable display label
   */
  public static formatSourceLocation(citation: Citation): FormattedSourceLocation {
    const docName = citation.documentName || 'document.pdf';
    const ext = docName.split('.').pop()?.toLowerCase() || 'pdf';
    const section = citation.sectionTitle || (citation.sectionPath && citation.sectionPath.length > 0 ? citation.sectionPath.join(' > ') : '');

    let displayLabel = `📄 ${docName}`;

    if (ext === 'pdf') {
      const pageStr = citation.pageStart ? `Trang ${citation.pageStart}` : '';
      displayLabel = [docName, pageStr, section].filter(Boolean).join(' · ');
    } else if (ext === 'docx') {
      displayLabel = `📝 ${docName}${section ? ' · ' + section : ''}`;
    } else {
      displayLabel = [docName, section].filter(Boolean).join(' · ');
    }

    return {
      displayLabel,
      documentName: docName,
      sourceType: ext,
      sectionTitle: citation.sectionTitle,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd
    };
  }

  /**
   * Parses Evidence IDs like [E1], [E2] from generated answer text
   */
  public static validateAndMapCitations(
    rawAnswer: string,
    evidencePool: Citation[]
  ): VerifiedCitationResult {
    const warnings: string[] = [];
    const citedEvidences: Citation[] = [];

    const citationRegex = /\[E(\d+)\]/g;
    const matches = Array.from(rawAnswer.matchAll(citationRegex));
    const citedIndices = new Set<number>();

    for (const match of matches) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < evidencePool.length) {
        citedIndices.add(idx);
      } else {
        warnings.push(`Phát hiện mã trích dẫn không hợp lệ: [E${idx + 1}].`);
      }
    }

    for (const idx of citedIndices) {
      citedEvidences.push(evidencePool[idx]);
    }

    if (citedEvidences.length === 0 && evidencePool.length > 0) {
      evidencePool.slice(0, 3).forEach(e => citedEvidences.push(e));
    }

    const formattedSources = citedEvidences.map(c => CitationValidator.formatSourceLocation(c));

    return {
      answer: rawAnswer,
      citedEvidences,
      formattedSources,
      hasInvalidCitations: warnings.length > 0,
      warnings
    };
  }
}
