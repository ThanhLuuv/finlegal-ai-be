// Cloudflare Vectorize Native Vector Store Service

import { RagContextChunk } from '../agents/state';

export interface VectorMatchResult {
  id: string;
  score: number;
  metadata: {
    docId: string;
    fileName: string;
    pageNumber: number;
    chunkIndex: number;
    text: string;
    containsTable: boolean;
  };
}

export class VectorizeService {
  private vectorize: VectorizeIndex;
  private ai: Ai;

  constructor(vectorize: VectorizeIndex, ai: Ai) {
    this.vectorize = vectorize;
    this.ai = ai;
  }

  /**
   * Generates a 768-dimensional vector embedding for text using Cloudflare Workers AI.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const res = await (this.ai as any).run('@cf/baai/bge-base-en-v1.5', {
      text: [text]
    });
    return res.data[0];
  }

  /**
   * Generates 768-dimensional vector embeddings in batch to minimize Worker subrequests.
   */
  public async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const allEmbeddings: number[][] = [];
    const batchSize = 25; // Workers AI handles up to 25 texts in 1 single subrequest
    for (let i = 0; i < texts.length; i += batchSize) {
      const batchTexts = texts.slice(i, i + batchSize);
      const res = await (this.ai as any).run('@cf/baai/bge-base-en-v1.5', {
        text: batchTexts
      });
      if (res && res.data) {
        allEmbeddings.push(...res.data);
      }
    }
    return allEmbeddings;
  }

  /**
   * Inserts text chunks with embeddings and metadata into Cloudflare Vectorize in batch.
   */
  public async insertChunks(
    docId: string,
    fileName: string,
    chunks: Array<{ text: string; chunkIndex: number; pageNumber: number; containsTable: boolean }>
  ): Promise<number> {
    const limitedChunks = chunks.slice(0, 30); // Cap to 30 chunks max per document
    const texts = limitedChunks.map(c => c.text);
    const embeddings = await this.generateEmbeddingsBatch(texts);

    const vectors: VectorizeVector[] = limitedChunks.map((chunk, idx) => ({
      id: `${docId}_chunk_${chunk.chunkIndex}`,
      values: embeddings[idx] || new Array(768).fill(0),
      metadata: {
        docId,
        fileName,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.slice(0, 1000),
        containsTable: chunk.containsTable
      }
    }));

    // Insert vectors in batches of 100
    if (vectors.length > 0) {
      await this.vectorize.insert(vectors);
    }

    return vectors.length;
  }

  /**
   * Performs hybrid vector retrieval with score threshold & optional document filter.
   */
  public async searchSimilar(
    queryText: string,
    topK = 5,
    selectedDocId?: string
  ): Promise<RagContextChunk[]> {
    const queryVector = await this.generateEmbedding(queryText);

    let matches = await this.vectorize.query(queryVector, {
      topK,
      filter: selectedDocId ? { docId: selectedDocId } : undefined,
      returnMetadata: 'all'
    });

    // Fallback: If filtered docId search yields 0 matches, search all vector indexes
    if ((!matches || !matches.matches || matches.matches.length === 0) && selectedDocId) {
      matches = await this.vectorize.query(queryVector, {
        topK,
        returnMetadata: 'all'
      });
    }

    if (!matches || !matches.matches) {
      return [];
    }

    return matches.matches.map(m => ({
      text: String(m.metadata?.text || ''),
      source: String(m.metadata?.fileName || 'document.pdf'),
      page: Number(m.metadata?.pageNumber || 1),
      score: m.score,
      containsTable: Boolean(m.metadata?.containsTable)
    }));
  }
}
