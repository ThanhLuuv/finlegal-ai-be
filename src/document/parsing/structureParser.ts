// LLM Fact-Preserving Structure Parser
// Uses AgentRouter (gpt-5.6-sol) to normalize document structure into Blocks & Sections WITHOUT altering facts

import { LLMProviderService } from '../../services/llm';
import { ParsedDocument, DocumentBlock, DocumentSection, DocumentTable } from '../types';
import { RawExtractedDocument } from '../extraction/pdfExtractor';

export class StructureParser {
  private llm: LLMProviderService;

  constructor(llm: LLMProviderService) {
    this.llm = llm;
  }

  /**
   * Parses raw extracted document into structured ParsedDocument
   */
  public async parse(rawDoc: RawExtractedDocument, docId: string, fileName: string): Promise<ParsedDocument> {
    const rawText = rawDoc.text || '';
    const warnings: string[] = [];

    if (!rawText || rawText.trim().length === 0) {
      return {
        documentId: docId,
        title: fileName,
        pages: rawDoc.pages || [],
        sections: [],
        blocks: [],
        tables: [],
        metadata: {
          fileName,
          mimeType: 'application/pdf',
          pageCount: rawDoc.pageCount || 1,
          documentType: 'generic',
          processingVersion: 'v2.0',
          extractionMethod: rawDoc.extractionMethod
        },
        rawText: '',
        warnings: ['Văn bản tài liệu trống.']
      };
    }

    const sample = rawText.slice(0, 10000);

    let parsedBlocks: DocumentBlock[] = [];
    let parsedSections: DocumentSection[] = [];
    let parsedTables: DocumentTable[] = [];

    try {
      const jsonResponse = await this.llm.generateJSON<{
        documentType?: string;
        title?: string;
        sections?: Array<{
          title: string;
          level?: number;
          type?: string;
          content: string;
          subsections?: string[];
        }>;
        tables?: Array<{
          page?: number;
          headers: string[];
          rows: string[][];
        }>;
      }>([
        {
          role: 'system',
          content: `You are an expert Document Structure Normalizer for FinLegal AI.
Examine this extracted raw document text.
Identify:
1. Document Type (e.g., 'contract', 'financial_report', 'resume', 'sop', 'invoice', 'manual').
2. Document Title.
3. Sections / Headings / Clauses (e.g. 'Điều 1', 'Executive Summary', 'Experience').
4. Tables (headers and rows).

CRITICAL REQUIREMENT: Do NOT modify, rewrite, or hallucinate any numbers, names, or facts. Return valid JSON only.`
        },
        {
          role: 'user',
          content: `FILE NAME: ${fileName}\n\nRAW EXTRACTED TEXT:\n${sample}`
        }
      ]);

      if (jsonResponse.sections && Array.isArray(jsonResponse.sections)) {
        parsedSections = jsonResponse.sections.map((sec, idx) => ({
          id: `sec_${docId}_${idx + 1}`,
          title: sec.title || `Mục ${idx + 1}`,
          sectionPath: [sec.title || `Mục ${idx + 1}`],
          pageStart: 1,
          pageEnd: rawDoc.pageCount || 1,
          content: sec.content || '',
          level: sec.level || 1
        }));
      }

      if (jsonResponse.tables && Array.isArray(jsonResponse.tables)) {
        parsedTables = jsonResponse.tables.map((tbl, idx) => ({
          id: `tbl_${docId}_${idx + 1}`,
          page: tbl.page || 1,
          headers: tbl.headers || [],
          rows: tbl.rows || [],
          markdown: `| ${tbl.headers.join(' | ')} |\n| ${tbl.headers.map(() => '---').join(' | ')} |\n` +
            tbl.rows.map(r => `| ${r.join(' | ')} |`).join('\n')
        }));
      }
    } catch (err) {
      warnings.push(`Chương trình phân tích cấu trúc AI vừa chuyển sang chế độ dự phòng tự động.`);
    }

    // Fallback block building if sections/blocks are empty
    if (parsedSections.length === 0) {
      const paragraphs = rawText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      parsedBlocks = paragraphs.map((p, idx) => ({
        id: `blk_${docId}_${idx + 1}`,
        type: 'paragraph',
        content: p.trim(),
        page: Math.floor(idx / 5) + 1
      }));

      parsedSections.push({
        id: `sec_${docId}_main`,
        title: fileName,
        sectionPath: [fileName],
        pageStart: 1,
        pageEnd: rawDoc.pageCount || 1,
        content: rawText
      });
    }

    return {
      documentId: docId,
      title: fileName,
      pages: rawDoc.pages || [],
      sections: parsedSections,
      blocks: parsedBlocks,
      tables: parsedTables,
      metadata: {
        fileName,
        mimeType: 'application/pdf',
        pageCount: rawDoc.pageCount || 1,
        documentType: 'generic',
        processingVersion: 'v2.0',
        extractionMethod: rawDoc.extractionMethod
      },
      rawText,
      warnings
    };
  }
}
