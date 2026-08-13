// Independent Structure & Fact Consistency Validator
// Ensures post-LLM parsed blocks match rawText without hallucinating facts or broken section trees

import { ParsedDocument, DocumentBlock, DocumentSection } from '../types';

export type StructureValidationStatus = 'PASS' | 'WARNING' | 'REJECT';

export interface ValidationResult {
  status: StructureValidationStatus;
  isValid: boolean;
  warnings: string[];
  validatedDocument: ParsedDocument;
}

export class StructureValidator {
  /**
   * Validates parsed document blocks and sections against rawText facts
   */
  public validate(document: ParsedDocument): ValidationResult {
    const warnings: string[] = [];
    const rawLower = (document.rawText || '').toLowerCase();
    let status: StructureValidationStatus = 'PASS';

    // 1. Verify blocks are grounded in raw text (Check entity & date integrity)
    const validBlocks: DocumentBlock[] = [];
    for (const block of document.blocks) {
      if (!block.content || block.content.trim().length === 0) continue;

      // Extract numbers & dates from block content
      const numbersInBlock = block.content.match(/\d+[\.,]?\d*/g) || [];
      let missingNumbers = 0;
      for (const num of numbersInBlock) {
        if (num.length > 2 && !rawLower.includes(num.toLowerCase())) {
          missingNumbers++;
        }
      }

      // If more than 50% of numbers in a block are absent from raw text, flag as possible LLM hallucination & drop block
      if (numbersInBlock.length > 3 && missingNumbers > numbersInBlock.length / 2) {
        status = 'WARNING';
        warnings.push(`Phát hiện và loại bỏ khối text "${block.content.slice(0, 40)}..." do chứa số liệu tự sinh không thuộc file gốc.`);
        continue; // Reject ungrounded block
      }

      validBlocks.push(block);
    }

    // 2. Validate Page Range Boundaries & Section Path Integrity
    const validSections: DocumentSection[] = [];
    for (const sec of document.sections) {
      const pageStart = sec.pageStart || 1;
      const pageEnd = sec.pageEnd || pageStart;

      if (pageEnd < pageStart) {
        if (status === 'PASS') status = 'WARNING';
        warnings.push(`Cảnh báo: Mục "${sec.title}" có khoảng trang không hợp lệ (${pageStart} - ${pageEnd}). Đã tự động điều chỉnh.`);
      }

      validSections.push({
        ...sec,
        pageStart,
        pageEnd: Math.max(pageStart, pageEnd),
        sectionPath: sec.sectionPath && sec.sectionPath.length > 0 ? sec.sectionPath : [sec.title || 'Mục chính']
      });
    }

    // 3. Validate Table Column/Row Consistency
    for (const table of document.tables) {
      if (table.rows && table.rows.length > 0) {
        const headerCount = table.headers ? table.headers.length : 0;
        const inconsistentRows = table.rows.filter(r => r.length !== headerCount);
        if (inconsistentRows.length > 0 && headerCount > 0) {
          if (status === 'PASS') status = 'WARNING';
          warnings.push(`Cảnh báo: Bảng ở trang ${table.page} có ${inconsistentRows.length} dòng không khớp số lượng cột.`);
        }
      }
    }

    // Critical failure check
    const isValid = validSections.length > 0 || validBlocks.length > 0;
    if (!isValid) {
      status = 'REJECT';
    }

    return {
      status,
      isValid,
      warnings,
      validatedDocument: {
        ...document,
        blocks: validBlocks,
        sections: validSections,
        warnings: [...document.warnings, ...warnings]
      }
    };
  }
}

