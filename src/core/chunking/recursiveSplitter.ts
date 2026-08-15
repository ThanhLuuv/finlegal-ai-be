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
  chunkSizeTokens?: number; // Target 600 - 800 tokens
  chunkOverlapTokens?: number; // Target 120 - 150 tokens
  separators?: string[];
}

export class RecursiveCharacterTextSplitter {
  private chunkSizeChars: number;
  private chunkOverlapChars: number;
  private separators: string[];

  constructor(options?: SplitterOptions) {
    // Approx 1 token ≈ 4 characters for Vietnamese/English text mix
    const targetTokens = options?.chunkSizeTokens || 700;
    const overlapTokens = options?.chunkOverlapTokens || 135;

    this.chunkSizeChars = targetTokens * 4; // ~2800 chars
    this.chunkOverlapChars = overlapTokens * 4; // ~540 chars
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
   * Recursively splits document text into semantic chunks with overlap & metadata
   */
  public splitText(
    fullText: string,
    docId: string,
    fileName: string,
    defaultPageStart = 1
  ): StructuredRagChunk[] {
    const cleanText = (fullText || '').replace(/\r/g, '').trim();
    if (!cleanText) return [];

    const rawSegments = this.splitRecursive(cleanText, this.separators);
    const mergedBlocks = this.mergeSegmentsWithOverlap(rawSegments);

    const chunks: StructuredRagChunk[] = [];
    let cumulativePage = defaultPageStart;

    for (let i = 0; i < mergedBlocks.length; i++) {
      const content = mergedBlocks[i].trim();
      if (content.length === 0) continue;

      // Extract section title from Markdown headers if present (# Title or ## Section)
      const headerMatch = content.match(/^#{1,4}\s+(.+)$/m);
      const sectionTitle = headerMatch ? headerMatch[1].trim() : 'Nội dung tài liệu';
      const containsTable = content.includes('|') && content.split('\n').some(line => line.trim().startsWith('|'));
      const tokenCount = this.estimateTokens(content);

      const chunkId = `${docId}_chunk_${i}`;

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
          pageStart: cumulativePage,
          pageEnd: cumulativePage,
          sectionTitle,
          sectionPath: [sectionTitle],
          tokenCount,
          containsTable
        }
      });
    }

    return chunks;
  }

  /**
   * Internal recursive splitting algorithm
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
