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

      // Parent Chunk ID for section hierarchy
      const parentChunkId = `${doc.documentId}_parent_sec_${section.id}`;

      // Create Parent Section Chunk (Large context for LLM Context Builder)
      const parentEmbeddingText = `${headerPrefix}${sectionContent}`;
      const parentChunk: RagChunk = {
        id: parentChunkId,
        documentId: doc.documentId,
        sectionId: section.id,
        parentChunkId: undefined,
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
          sectionId: section.id,
          parentChunkId: undefined,
          chunkIndex,
          documentType: doc.metadata.documentType || 'generic',
          containsTable: sectionContent.includes('|'),
          text: sectionContent,
          embeddingText: parentEmbeddingText
        }
      };
      chunks.push(parentChunk);
      chunkIndex++;

      // If section is large, create Child Chunks (Fine-grained for Dense Vector Search)
      if (sectionContent.length > 1500) {
        const paragraphs = sectionContent.split(/\n\s*\n/);
        let currentChunkText = '';

        const pushChildChunk = (rawContent: string) => {
          const content = rawContent.trim();
          if (!content) return;

          const childEmbeddingText = `${headerPrefix}${content}`;
          chunks.push({
            id: `${doc.documentId}_child_${chunkIndex}`,
            documentId: doc.documentId,
            sectionId: section.id,
            parentChunkId: parentChunkId,
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
              sectionId: section.id,
              parentChunkId: parentChunkId,
              chunkIndex,
              documentType: doc.metadata.documentType || 'generic',
              containsTable: content.includes('|'),
              text: content,
              embeddingText: childEmbeddingText
            }
          });
          chunkIndex++;
        };

        for (const para of paragraphs) {
          if ((currentChunkText + '\n\n' + para).length > 1200) {
            pushChildChunk(currentChunkText);
            currentChunkText = para;
          } else {
            currentChunkText = currentChunkText ? `${currentChunkText}\n\n${para}` : para;
          }
        }
        if (currentChunkText.trim().length > 0) {
          pushChildChunk(currentChunkText);
        }
      }
    }

    return chunks;
  }
}
