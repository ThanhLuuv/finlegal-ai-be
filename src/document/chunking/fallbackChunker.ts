// Sliding Window Fallback Chunker with Header Context Injection (1200 chars, 250 char overlap)

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

  constructor(chunkSize = 1200, overlap = 250) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  public chunk(doc: ParsedDocument): RagChunk[] {
    const text = doc.rawText || '';
    if (text.length === 0) return [];

    const docName = doc.metadata.fileName || 'Tài liệu';
    const docTitle = doc.title || docName;
    const headerPrefix = `[TÀI LIỆU: ${docName} | TIÊU ĐỀ: ${docTitle}]\n`;

    const chunks: RagChunk[] = [];
    let chunkIdx = 0;
    let pos = 0;

    while (pos < text.length) {
      const end = Math.min(pos + this.chunkSize, text.length);
      const rawChunkText = text.substring(pos, end).trim();

      if (rawChunkText.length > 0) {
        const enrichedContent = `${headerPrefix}${rawChunkText}`;
        chunks.push({
          id: `${doc.documentId}_chunk_${chunkIdx}`,
          documentId: doc.documentId,
          content: enrichedContent,
          chunkType: 'paragraph',
          tokenCount: Math.ceil(enrichedContent.length / 4),
          contentHash: simpleHash(enrichedContent),
          embeddingVersion: 'v1',
          pageStart: 1,
          pageEnd: doc.metadata.pageCount || 1,
          metadata: {
            docId: doc.documentId,
            fileName: docName,
            pageStart: 1,
            pageEnd: doc.metadata.pageCount || 1,
            sectionTitle: docTitle,
            sectionPath: [docTitle],
            chunkIndex: chunkIdx,
            documentType: doc.metadata.documentType || 'generic',
            containsTable: rawChunkText.includes('|'),
            text: enrichedContent
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
