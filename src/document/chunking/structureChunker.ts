// Hierarchy & Structure-Aware Document Chunker
// Attaches sectionPath (["Điều 7", "Khoản 7.2"]), sectionTitle, pageStart, pageEnd, tokenCount, contentHash to every chunk

import { ParsedDocument, RagChunk } from '../types';
import { FallbackChunker } from './fallbackChunker';

function generateHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export class StructureChunker {
  private fallbackChunker: FallbackChunker;

  constructor() {
    this.fallbackChunker = new FallbackChunker(1000, 200);
  }

  public chunk(doc: ParsedDocument): RagChunk[] {
    if (!doc.sections || doc.sections.length === 0) {
      return this.fallbackChunker.chunk(doc);
    }

    const chunks: RagChunk[] = [];
    let chunkIndex = 0;

    for (const section of doc.sections) {
      const sectionContent = (section.content || '').trim();
      if (sectionContent.length === 0) continue;

      // If section is small enough, keep as single section chunk
      if (sectionContent.length <= 1200) {
        chunks.push({
          id: `${doc.documentId}_chunk_${chunkIndex}`,
          documentId: doc.documentId,
          sectionId: section.id,
          content: sectionContent,
          chunkType: 'section',
          tokenCount: Math.ceil(sectionContent.length / 4),
          contentHash: generateHash(sectionContent),
          embeddingVersion: 'v1',
          pageStart: section.pageStart || 1,
          pageEnd: section.pageEnd || 1,
          metadata: {
            docId: doc.documentId,
            fileName: doc.metadata.fileName,
            pageStart: section.pageStart || 1,
            pageEnd: section.pageEnd || 1,
            sectionTitle: section.title || 'Mục chính',
            sectionPath: section.sectionPath || [section.title || 'Mục chính'],
            chunkIndex,
            documentType: doc.metadata.documentType || 'generic',
            containsTable: sectionContent.includes('|'),
            text: sectionContent
          }
        });
        chunkIndex++;
      } else {
        // Sub-chunk long sections into ~800-1000 char blocks
        const paragraphs = sectionContent.split(/\n\s*\n/);
        let currentChunkText = '';

        for (const para of paragraphs) {
          if ((currentChunkText + '\n\n' + para).length > 1000 && currentChunkText.length > 0) {
            chunks.push({
              id: `${doc.documentId}_chunk_${chunkIndex}`,
              documentId: doc.documentId,
              sectionId: section.id,
              content: currentChunkText.trim(),
              chunkType: 'paragraph',
              tokenCount: Math.ceil(currentChunkText.length / 4),
              contentHash: generateHash(currentChunkText),
              embeddingVersion: 'v1',
              pageStart: section.pageStart || 1,
              pageEnd: section.pageEnd || 1,
              metadata: {
                docId: doc.documentId,
                fileName: doc.metadata.fileName,
                pageStart: section.pageStart || 1,
                pageEnd: section.pageEnd || 1,
                sectionTitle: section.title || 'Mục chính',
                sectionPath: section.sectionPath || [section.title || 'Mục chính'],
                chunkIndex,
                documentType: doc.metadata.documentType || 'generic',
                containsTable: currentChunkText.includes('|'),
                text: currentChunkText.trim()
              }
            });
            chunkIndex++;
            currentChunkText = para;
          } else {
            currentChunkText = currentChunkText ? `${currentChunkText}\n\n${para}` : para;
          }
        }

        if (currentChunkText.trim().length > 0) {
          chunks.push({
            id: `${doc.documentId}_chunk_${chunkIndex}`,
            documentId: doc.documentId,
            sectionId: section.id,
            content: currentChunkText.trim(),
            chunkType: 'paragraph',
            tokenCount: Math.ceil(currentChunkText.length / 4),
            contentHash: generateHash(currentChunkText),
            embeddingVersion: 'v1',
            pageStart: section.pageStart || 1,
            pageEnd: section.pageEnd || 1,
            metadata: {
              docId: doc.documentId,
              fileName: doc.metadata.fileName,
              pageStart: section.pageStart || 1,
              pageEnd: section.pageEnd || 1,
              sectionTitle: section.title || 'Mục chính',
              sectionPath: section.sectionPath || [section.title || 'Mục chính'],
              chunkIndex,
              documentType: doc.metadata.documentType || 'generic',
              containsTable: currentChunkText.includes('|'),
              text: currentChunkText.trim()
            }
          });
          chunkIndex++;
        }
      }
    }

    // Include structured tables as standalone table chunks
    for (const table of doc.tables) {
      if (table.markdown && table.markdown.trim().length > 0) {
        chunks.push({
          id: `${doc.documentId}_chunk_${chunkIndex}`,
          documentId: doc.documentId,
          content: table.markdown,
          chunkType: 'table',
          tokenCount: Math.ceil(table.markdown.length / 4),
          contentHash: generateHash(table.markdown),
          embeddingVersion: 'v1',
          pageStart: table.page || 1,
          pageEnd: table.page || 1,
          metadata: {
            docId: doc.documentId,
            fileName: doc.metadata.fileName,
            pageStart: table.page || 1,
            pageEnd: table.page || 1,
            sectionTitle: `Bảng dữ liệu (Trang ${table.page})`,
            sectionPath: [`Bảng dữ liệu (Trang ${table.page})`],
            chunkIndex,
            documentType: doc.metadata.documentType || 'generic',
            containsTable: true,
            text: table.markdown
          }
        });
        chunkIndex++;
      }
    }

    return chunks.length > 0 ? chunks : this.fallbackChunker.chunk(doc);
  }
}
