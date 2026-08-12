// Structure-Aware Table-Preserving Chunker Service

export interface ChunkOutput {
  text: string;
  chunkIndex: number;
  pageNumber: number;
  containsTable: boolean;
}

export class TablePreservingChunker {
  private maxChunkSize: number;
  private chunkOverlap: number;

  constructor(maxChunkSize = 800, chunkOverlap = 150) {
    this.maxChunkSize = maxChunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  /**
   * Chunks raw document text into semantically cohesive, table-preserved chunks.
   */
  public chunkDocument(rawText: string, defaultPage = 1): ChunkOutput[] {
    const lines = rawText.split('\n');
    const chunks: ChunkOutput[] = [];
    let currentChunkLines: string[] = [];
    let currentChunkSize = 0;
    let inTable = false;
    let tableHeaderLines: string[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');

      if (isTableLine) {
        if (!inTable) {
          inTable = true;
          tableHeaderLines = [line];
          // If next line is separator (|---|---|), grab it too as header
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith('|') && lines[i + 1].includes('-')) {
            tableHeaderLines.push(lines[i + 1]);
            i++;
          }
        }

        // Attach header lines to current chunk if not already present
        if (currentChunkLines.length === 0 && tableHeaderLines.length > 0) {
          currentChunkLines.push(...tableHeaderLines);
          currentChunkSize += tableHeaderLines.join('\n').length;
        }

        currentChunkLines.push(line);
        currentChunkSize += line.length + 1;
      } else {
        if (inTable) {
          // Table ended
          inTable = false;
          tableHeaderLines = [];
        }

        currentChunkLines.push(line);
        currentChunkSize += line.length + 1;
      }

      // Flush chunk if size limit reached or at end of text
      if (currentChunkSize >= this.maxChunkSize || i === lines.length - 1) {
        if (currentChunkLines.length > 0) {
          const chunkText = currentChunkLines.join('\n').trim();
          if (chunkText.length > 0) {
            chunks.push({
              text: chunkText,
              chunkIndex: chunkIndex++,
              pageNumber: defaultPage,
              containsTable: chunkText.includes('|') && chunkText.split('\n').some(l => l.trim().startsWith('|')),
            });
          }

          // Prepare overlap for next chunk
          const overlapLines = this.calculateOverlapLines(currentChunkLines);
          currentChunkLines = inTable && tableHeaderLines.length > 0 ? [...tableHeaderLines, ...overlapLines] : overlapLines;
          currentChunkSize = currentChunkLines.join('\n').length;
        }
      }
    }

    return chunks;
  }

  private calculateOverlapLines(lines: string[]): string[] {
    let size = 0;
    const result: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      size += lines[i].length;
      if (size > this.chunkOverlap) break;
      result.unshift(lines[i]);
    }
    return result;
  }
}
