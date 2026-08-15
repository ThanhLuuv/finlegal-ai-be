// High-Performance Custom Recursive Character Text Splitter (Pure TS, Edge Workers Compatible)

export interface ChunkMetadata {
  docId: string;
  fileName: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle?: string;
  sectionPath?: string[];
  parentChunkId?: string;
  tokenCount: number;
  containsTable?: boolean;
}

export interface StructuredRagChunk {
  id: string;
  documentId: string;
  tenantId?: string;
  content: string;
  metadata: ChunkMetadata;
  tokenCount: number;
  chunkType: 'text' | 'table' | 'header';
}

export interface SplitterOptions {
  chunkSizeTokens?: number; // Target 450 - 600 tokens
  chunkOverlapTokens?: number; // Target 50 - 100 tokens
  separators?: string[];
}

function computeSimpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export class RecursiveCharacterTextSplitter {
  private chunkSizeChars: number;
  private chunkOverlapChars: number;
  private separators: string[];

  constructor(options?: SplitterOptions) {
    // Approx 1 token ≈ 4 characters for Vietnamese/English text mix
    const targetTokens = options?.chunkSizeTokens || 500;
    const overlapTokens = options?.chunkOverlapTokens || 75;

    this.chunkSizeChars = targetTokens * 4; // ~2000 chars (~500 tokens)
    this.chunkOverlapChars = overlapTokens * 4; // ~300 chars (~75 tokens)
    this.separators = options?.separators || ['\n\n', '\n', '. ', '; ', ' ', ''];
  }

  /**
   * Estimates token count for text (1 token ≈ 4 chars)
   */
  public estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.trim().length / 4);
  }

  /**
   * Structure-First Chunking Pipeline with Content-Hash Deterministic Chunk IDs & Table Header Preservation
   */
  public splitText(
    fullText: string,
    docId: string,
    fileName: string,
    defaultPageStart = 1
  ): StructuredRagChunk[] {
    const cleanText = (fullText || '').replace(/\r/g, '').trim();
    if (!cleanText) return [];

    // Step 1: Detect Structural Sections
    const rawStructuralBlocks = this.extractStructuralBlocks(cleanText);
    const finalBlocks: string[] = [];

    for (const block of rawStructuralBlocks) {
      if (block.length <= this.chunkSizeChars) {
        finalBlocks.push(block);
      } else {
        // If large table, preserve table header row across sub-slices
        const isTable = block.includes('|') && block.split('\n').some(l => l.trim().startsWith('|'));
        let tableHeader = '';
        if (isTable) {
          const lines = block.split('\n').filter(l => l.trim().length > 0);
          if (lines.length >= 2 && lines[0].includes('|') && lines[1].includes('|')) {
            tableHeader = lines[0] + '\n' + lines[1] + '\n';
          }
        }

        const subSegments = this.splitRecursive(block, this.separators);
        const mergedSubs = this.mergeSegmentsWithOverlap(subSegments);

        const firstHeaderLine = tableHeader.split('\n')[0] || '';
        for (const sub of mergedSubs) {
          if (tableHeader && firstHeaderLine && !sub.startsWith(firstHeaderLine)) {
            finalBlocks.push(tableHeader + sub);
          } else {
            finalBlocks.push(sub);
          }
        }
      }
    }

    const chunks: StructuredRagChunk[] = [];
    let currentSectionTitle = 'Nội dung tài liệu';
    const sectionPath: string[] = [];

    for (let i = 0; i < finalBlocks.length; i++) {
      const content = finalBlocks[i].trim();
      if (content.length === 0) continue;

      // Extract section title from Markdown headers if present
      const headerMatch = content.match(/^#{1,4}\s+(.+)$/m);
      if (headerMatch) {
        currentSectionTitle = headerMatch[1].trim();
        if (!sectionPath.includes(currentSectionTitle)) {
          sectionPath.push(currentSectionTitle);
        }
      }

      const containsTable = content.includes('|') && content.split('\n').some(line => line.trim().startsWith('|'));
      const tokenCount = this.estimateTokens(content);

      // Deterministic Content-Hash Chunk ID for Idempotency
      const contentHash = computeSimpleHash(content);
      const chunkId = `${docId}_v1_c${i}_${contentHash}`;

      chunks.push({
        id: chunkId,
        documentId: docId,
        tenantId: 'tenant_default',
        content,
        tokenCount,
        chunkType: containsTable ? 'table' : 'text',
        metadata: {
          docId,
          fileName,
          chunkIndex: i,
          pageStart: defaultPageStart,
          pageEnd: defaultPageStart,
          sectionTitle: currentSectionTitle,
          sectionPath: [...sectionPath],
          tokenCount,
          containsTable
        }
      });
    }

    return chunks;
  }

  /**
   * Structure Detector: Splits document by Markdown headers & tables
   */
  private extractStructuralBlocks(text: string): string[] {
    const lines = text.split('\n');
    const blocks: string[] = [];
    let currentBlock: string[] = [];

    for (const line of lines) {
      const isHeader = /^#{1,4}\s+/.test(line.trim());
      const isTableStart = line.trim().startsWith('|') && currentBlock.length > 0 && !currentBlock[currentBlock.length - 1].trim().startsWith('|');

      if ((isHeader || isTableStart) && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      currentBlock.push(line);
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'));
    }

    return blocks.filter(b => b.trim().length > 0);
  }

  /**
   * Internal recursive splitting algorithm for blocks > 500 tokens
   */
  private splitRecursive(text: string, separators: string[]): string[] {
    const finalChunks: string[] = [];

    if (text.length <= this.chunkSizeChars || separators.length === 0) {
      return [text];
    }

    const separator = separators[0];
    const nextSeparators = separators.slice(1);
    const splits = text.split(separator);

    let currentBuffer = '';

    for (const s of splits) {
      const piece = currentBuffer ? currentBuffer + separator + s : s;

      if (piece.length <= this.chunkSizeChars) {
        currentBuffer = piece;
      } else {
        if (currentBuffer) {
          finalChunks.push(currentBuffer);
          currentBuffer = '';
        }

        if (s.length > this.chunkSizeChars && nextSeparators.length > 0) {
          const subSplits = this.splitRecursive(s, nextSeparators);
          finalChunks.push(...subSplits);
        } else {
          currentBuffer = s;
        }
      }
    }

    if (currentBuffer) {
      finalChunks.push(currentBuffer);
    }

    return finalChunks;
  }

  /**
   * Merges segments to target chunkSize while appending chunkOverlap from previous block
   */
  private mergeSegmentsWithOverlap(segments: string[]): string[] {
    const result: string[] = [];
    let currentChunk = '';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      if (!seg) continue;

      if (!currentChunk) {
        currentChunk = seg;
      } else if ((currentChunk.length + seg.length + 2) <= this.chunkSizeChars) {
        currentChunk += '\n\n' + seg;
      } else {
        result.push(currentChunk);

        // Calculate overlap tail from currentChunk
        const overlapTail = this.extractOverlapTail(currentChunk, this.chunkOverlapChars);
        currentChunk = overlapTail ? overlapTail + '\n\n' + seg : seg;
      }
    }

    if (currentChunk.trim().length > 0) {
      result.push(currentChunk.trim());
    }

    return result;
  }

  /**
   * Helper to extract trailing overlap chars cleanly at word/sentence boundaries
   */
  private extractOverlapTail(text: string, targetOverlapChars: number): string {
    if (text.length <= targetOverlapChars) return text;
    const slice = text.slice(-targetOverlapChars);
    const firstSpace = slice.indexOf(' ');
    return firstSpace !== -1 ? slice.slice(firstSpace + 1) : slice;
  }
}
