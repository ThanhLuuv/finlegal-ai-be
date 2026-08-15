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
   * Preserves 100% verbatim text across ALL pages without text truncation or LLM content duplication bugs.
   */
  public async parse(rawDoc: RawExtractedDocument, docId: string, fileName: string): Promise<ParsedDocument> {
    const rawText = rawDoc.text || '';
    const warnings: string[] = [];
    const pages = rawDoc.pages || [];

    if (!rawText || rawText.trim().length === 0) {
      return {
        documentId: docId,
        title: fileName,
        pages: pages,
        sections: [],
        blocks: [],
        tables: [],
        metadata: {
          fileName,
          mimeType: 'application/pdf',
          pageCount: rawDoc.pageCount || 1,
          documentType: 'generic',
          processingVersion: 'v3.0',
          extractionMethod: rawDoc.extractionMethod
        },
        rawText: '',
        warnings: ['Văn bản tài liệu trống.']
      };
    }

    const parsedSections: DocumentSection[] = [];
    const parsedBlocks: DocumentBlock[] = [];

    // Step 1: Flatten Pages into a Global Block Stream (P1.6 Cross-Page Continuity)
    const globalBlocks: Array<{ blockId: string; pageNumber: number; content: string }> = [];
    for (const p of pages) {
      const paragraphs = p.content.split(/\n\s*\n/).filter(str => str.trim().length > 0);
      for (const para of paragraphs) {
        const blkId = `blk_${docId}_${globalBlocks.length + 1}`;
        globalBlocks.push({
          blockId: blkId,
          pageNumber: p.pageNumber,
          content: para.trim()
        });
        parsedBlocks.push({
          id: blkId,
          type: 'paragraph',
          content: para.trim(),
          page: p.pageNumber
        });
      }
    }

    // Step 2: Detect Section Headings across the Global Block Stream (Contracts, CVs & Markdown Documents)
    const headingRegex = /^(#+\s+.*|Điều\s+\d+|Chương\s+[IVXLCDM\d]+|Mục\s+\d+|Khoản\s+\d+\.\d+|Section\s+\d+|Part\s+\d+|(THÔNG TIN|KINH NGHIỆM|HỌC VẤN|KỸ NĂNG|DỰ ÁN|MỤC TIÊU|CHỨNG CHỈ|WORK EXPERIENCE|EXPERIENCE|EDUCATION|SKILLS|PROJECTS|SUMMARY|PROFILE|CONTACT|PERSONAL INFO)[^:\n]*:?|[A-Z\d\.\s]{3,40}:)/i;
    const sectionGroups: Array<{
      title: string;
      startBlockIdx: number;
      endBlockIdx: number;
      pageStart: number;
      pageEnd: number;
      blocks: Array<{ pageNumber: number; content: string }>;
    }> = [];

    let currentSection: {
      title: string;
      startBlockIdx: number;
      endBlockIdx: number;
      pageStart: number;
      pageEnd: number;
      blocks: Array<{ pageNumber: number; content: string }>;
    } | null = null;

    for (let i = 0; i < globalBlocks.length; i++) {
      const blk = globalBlocks[i];
      const match = blk.content.match(headingRegex);

      if (match) {
        if (currentSection) {
          currentSection.endBlockIdx = i - 1;
          sectionGroups.push(currentSection);
        }
        currentSection = {
          title: match[1].trim(),
          startBlockIdx: i,
          endBlockIdx: i,
          pageStart: blk.pageNumber,
          pageEnd: blk.pageNumber,
          blocks: [blk]
        };
      } else if (currentSection) {
        currentSection.endBlockIdx = i;
        currentSection.pageEnd = blk.pageNumber;
        currentSection.blocks.push(blk);
      } else {
        // Ensure content before the first heading (Candidate Name, Contact Info, Header) is NEVER discarded
        currentSection = {
          title: 'Thông tin chung',
          startBlockIdx: i,
          endBlockIdx: i,
          pageStart: blk.pageNumber,
          pageEnd: blk.pageNumber,
          blocks: [blk]
        };
      }
    }

    if (currentSection) {
      sectionGroups.push(currentSection);
    }

    // Step 3: Build Verbatim Sections spanning across page boundaries
    if (sectionGroups.length > 0) {
      for (let sIdx = 0; sIdx < sectionGroups.length; sIdx++) {
        const sec = sectionGroups[sIdx];
        const verbatimContent = sec.blocks.map(b => b.content).join('\n\n');

        parsedSections.push({
          id: `sec_${docId}_${sIdx + 1}`,
          title: sec.title,
          sectionPath: [sec.title],
          pageStart: sec.pageStart,
          pageEnd: sec.pageEnd,
          content: verbatimContent,
          level: 1
        });
      }
    } else {
      // Fallback per page
      for (const p of pages) {
        parsedSections.push({
          id: `sec_${docId}_p${p.pageNumber}`,
          title: `${fileName} - Trang ${p.pageNumber}`,
          sectionPath: [fileName, `Trang ${p.pageNumber}`],
          pageStart: p.pageNumber,
          pageEnd: p.pageNumber,
          content: p.content
        });
      }
    }

    return {
      documentId: docId,
      title: fileName,
      pages,
      sections: parsedSections,
      blocks: parsedBlocks,
      tables: [],
      metadata: {
        fileName,
        mimeType: 'application/pdf',
        pageCount: rawDoc.pageCount || 1,
        documentType: 'generic',
        processingVersion: 'v3.2',
        extractionMethod: rawDoc.extractionMethod
      },
      rawText,
      warnings
    };
  }
}


