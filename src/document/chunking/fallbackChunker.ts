// Sliding Window Fallback Chunker (1000 chars, 200 char overlap)

import { ParsedDocument, RagChunk } from '../types';

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export class FallbackChunker {
  private chunkSize: number;
  private overlap: number;

  constructor(chunkSize = 1000, overlap = 200) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  public chunk(doc: ParsedDocument): RagChunk[] {
    const text = doc.rawText || '';
    if (text.length === 0) return [];

    const chunks: RagChunk[] = [];
    let chunkIdx = 0;
    let pos = 0;

    while (pos < text.length) {
      const end = Math.min(pos + this.chunkSize, text.length);
      const chunkText = text.substring(pos, end).trim();

      if (chunkText.length > 0) {
        chunks.push({
          id: `${doc.documentId}_chunk_${chunkIdx}`,
          documentId: doc.documentId,
          content: chunkText,
          chunkType: 'paragraph',
          tokenCount: Math.ceil(chunkText.length / 4),
          contentHash: simpleHash(chunkText),
          embeddingVersion: 'v1',
          pageStart: 1,
          pageEnd: doc.metadata.pageCount || 1,
          metadata: {
            docId: doc.documentId,
            fileName: doc.metadata.fileName,
            pageStart: 1,
            pageEnd: doc.metadata.pageCount || 1,
            sectionTitle: doc.title || doc.metadata.fileName,
            sectionPath: [doc.title || doc.metadata.fileName],
            chunkIndex: chunkIdx,
            documentType: doc.metadata.documentType || 'generic',
            containsTable: false,
            text: chunkText
          }
        });
        chunkIdx++;
      }

      if (end >= text.length) break;
      pos += this.chunkSize - this.overlap;
    }

    return chunks;
  }
}
