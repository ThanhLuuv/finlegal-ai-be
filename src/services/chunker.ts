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
   * Guarantees that no single chunk ever exceeds 1000 characters.
   */
  public chunkDocument(rawText: string, defaultPage = 1): ChunkOutput[] {
    // Normalize newlines and break long single-line blocks into 500-char paragraphs
    const paragraphs = rawText
      .replace(/\r/g, '')
      .split('\n')
      .flatMap(line => {
        if (line.length <= this.maxChunkSize) return [line];
        // Split long un-newline text by spaces or periods into sub-lines
        const subLines: string[] = [];
        let curr = '';
        const words = line.split(' ');
        for (const w of words) {
          if ((curr + ' ' + w).length > 600) {
            subLines.push(curr.trim());
            curr = w;
          } else {
            curr += (curr ? ' ' : '') + w;
          }
        }
        if (curr.trim().length > 0) subLines.push(curr.trim());
        return subLines;
      });

    const chunks: ChunkOutput[] = [];
    let currentChunkLines: string[] = [];
    let currentChunkSize = 0;
    let inTable = false;
    let tableHeaderLines: string[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const line = paragraphs[i];
      const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');

      if (isTableLine) {
        if (!inTable) {
          inTable = true;
          tableHeaderLines = [line];
          if (i + 1 < paragraphs.length && paragraphs[i + 1].trim().startsWith('|') && paragraphs[i + 1].includes('-')) {
            tableHeaderLines.push(paragraphs[i + 1]);
            i++;
          }
        }

        if (currentChunkLines.length === 0 && tableHeaderLines.length > 0) {
          currentChunkLines.push(...tableHeaderLines);
          currentChunkSize += tableHeaderLines.join('\n').length;
        }

        currentChunkLines.push(line);
        currentChunkSize += line.length + 1;
      } else {
        if (inTable) {
          inTable = false;
          tableHeaderLines = [];
        }

        currentChunkLines.push(line);
        currentChunkSize += line.length + 1;
      }

      if (currentChunkSize >= this.maxChunkSize || i === paragraphs.length - 1) {
        if (currentChunkLines.length > 0) {
          const chunkText = currentChunkLines.join('\n').trim();
          if (chunkText.length > 0) {
            chunks.push({
              text: chunkText.slice(0, 1000), // Hard safety cap to 1000 chars
              chunkIndex: chunkIndex++,
              pageNumber: defaultPage,
              containsTable: chunkText.includes('|') && chunkText.split('\n').some(l => l.trim().startsWith('|')),
            });
          }

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
