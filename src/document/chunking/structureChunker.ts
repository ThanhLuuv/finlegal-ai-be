// Dynamic Structure-Aware Document Chunker with Header Context Injection
// Automatically injects Document Title, Section Path, Page Start/End into content so every chunk contains full standalone context

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
    this.fallbackChunker = new FallbackChunker(1200, 250);
  }

  public chunk(doc: ParsedDocument): RagChunk[] {
    const docName = doc.metadata.fileName || 'Tài liệu';
    const docTitle = doc.title || docName;

    if (!doc.sections || doc.sections.length === 0) {
      return this.fallbackChunker.chunk(doc);
    }

    const chunks: RagChunk[] = [];
    let chunkIndex = 0;

    for (const section of doc.sections) {
      const sectionContent = (section.content || '').trim();
      if (sectionContent.length === 0) continue;

      const secTitle = section.title || 'Mục chính';
      const sectionPathStr = (section.sectionPath && section.sectionPath.length > 0)
        ? section.sectionPath.join(' > ')
        : secTitle;

      // Dynamic Context Header Prefix attached to metadata for embedding generation
      const headerPrefix = `Document: ${docName}\nSection: ${sectionPathStr}\nPage: ${section.pageStart || 1}\n`;

      // If section is small enough, keep as single section chunk
      if (sectionContent.length <= 1500) {
        const embeddingText = `${headerPrefix}${sectionContent}`;
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
            fileName: docName,
            pageStart: section.pageStart || 1,
            pageEnd: section.pageEnd || 1,
            sectionTitle: secTitle,
            sectionPath: section.sectionPath || [secTitle],
            chunkIndex,
            documentType: doc.metadata.documentType || 'generic',
            containsTable: sectionContent.includes('|'),
            text: sectionContent,
            embeddingText
          }
        });
        chunkIndex++;
      } else {
        // Sub-chunk long sections into ~1000 char blocks
        const paragraphs = sectionContent.split(/\n\s*\n/);
        let currentChunkText = '';

        const pushChunkText = (rawContent: string) => {
          const content = rawContent.trim();
          if (!content) return;

          const embeddingText = `${headerPrefix}${content}`;
          chunks.push({
            id: `${doc.documentId}_chunk_${chunkIndex}`,
            documentId: doc.documentId,
            sectionId: section.id,
            content: content,
            chunkType: 'paragraph',
            tokenCount: Math.ceil(content.length / 4),
            contentHash: generateHash(content),
            embeddingVersion: 'v1',
            pageStart: section.pageStart || 1,
            pageEnd: section.pageEnd || 1,
            metadata: {
              docId: doc.documentId,
              fileName: docName,
              pageStart: section.pageStart || 1,
              pageEnd: section.pageEnd || 1,
              sectionTitle: secTitle,
              sectionPath: section.sectionPath || [secTitle],
              chunkIndex,
              documentType: doc.metadata.documentType || 'generic',
              containsTable: content.includes('|'),
              text: content,
              embeddingText
            }
          });
          chunkIndex++;
        };

        for (const para of paragraphs) {
          if ((currentChunkText + '\n\n' + para).length <= 1200) {
            currentChunkText = currentChunkText ? `${currentChunkText}\n\n${para}` : para;
          } else {
            if (currentChunkText) {
              pushChunkText(currentChunkText);
              currentChunkText = para;
            } else {
              // Sliding window for giant single paragraph
              let start = 0;
              while (start < para.length) {
                const subStr = para.substring(start, start + 1200);
                pushChunkText(subStr);
                start += 950;
              }
            }
          }
        }

        if (currentChunkText) {
          pushChunkText(currentChunkText);
        }
      }
    }

    return chunks;
  }
}
