// Context Builder for RAG Retrieval (Deduplication, Adjacent Chunk Merging & Grounded Section Pointers)

import { ChunkMetadata } from '../chunking/recursiveSplitter';

export interface RetrievedCandidate {
  chunkId: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

export interface FormattedContext {
  combinedContext: string;
  citationSources: Array<{
    id: string;
    sectionTitle: string;
    fileName: string;
    pageStart: number;
    pageEnd: number;
  }>;
}

export class ContextBuilder {
  /**
   * Merges, deduplicates, and formats top RRF/Reranked candidate chunks into a structured LLM context budget
   */
  public buildContext(candidates: RetrievedCandidate[], maxTokens = 2500): FormattedContext {
    if (!candidates || candidates.length === 0) {
      return { combinedContext: '', citationSources: [] };
    }

    // Step 1: Deduplicate chunks by ID or exact content match
    const seenContent = new Set<string>();
    const uniqueCandidates: RetrievedCandidate[] = [];

    for (const cand of candidates) {
      const normContent = cand.text.trim();
      if (!seenContent.has(normContent)) {
        seenContent.add(normContent);
        uniqueCandidates.push(cand);
      }
    }

    // Step 2: Sort candidates by document structure order (chunkIndex)
    uniqueCandidates.sort((a, b) => (a.metadata.chunkIndex || 0) - (b.metadata.chunkIndex || 0));

    // Step 3: Merge adjacent chunks belonging to the same section
    const mergedBlocks: Array<{
      sectionTitle: string;
      fileName: string;
      pageStart: number;
      pageEnd: number;
      content: string;
      chunkIds: string[];
    }> = [];

    for (const cand of uniqueCandidates) {
      const sectionTitle = cand.metadata.sectionTitle || 'Nội dung';
      const fileName = cand.metadata.fileName || 'document.pdf';
      const pageStart = cand.metadata.pageStart || 1;
      const pageEnd = cand.metadata.pageEnd || 1;

      const lastBlock = mergedBlocks[mergedBlocks.length - 1];
      if (lastBlock && lastBlock.sectionTitle === sectionTitle && lastBlock.fileName === fileName) {
        lastBlock.content += '\n\n' + cand.text;
        lastBlock.chunkIds.push(cand.chunkId);
        lastBlock.pageEnd = Math.max(lastBlock.pageEnd, pageEnd);
      } else {
        mergedBlocks.push({
          sectionTitle,
          fileName,
          pageStart,
          pageEnd,
          content: cand.text,
          chunkIds: [cand.chunkId]
        });
      }
    }

    // Step 4: Build combined context string with clear grounding citations
    let combinedText = '';
    const citationSources: FormattedContext['citationSources'] = [];
    let currentEstimatedTokens = 0;

    for (let i = 0; i < mergedBlocks.length; i++) {
      const block = mergedBlocks[i];
      const blockTokenEst = Math.ceil(block.content.length / 4);

      if (currentEstimatedTokens + blockTokenEst > maxTokens && citationSources.length > 0) {
        break; // Respect token budget
      }

      const citationTag = `[E${i + 1}]`;
      const header = `--- TRÍCH DẪN ${citationTag}: ${block.sectionTitle} (${block.fileName}, Trang ${block.pageStart}) ---\n`;
      combinedText += `${header}${block.content}\n\n`;

      citationSources.push({
        id: citationTag,
        sectionTitle: block.sectionTitle,
        fileName: block.fileName,
        pageStart: block.pageStart,
        pageEnd: block.pageEnd
      });

      currentEstimatedTokens += blockTokenEst;
    }

    return {
      combinedContext: combinedText.trim(),
      citationSources
    };
  }
}
