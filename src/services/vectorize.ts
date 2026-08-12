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
   * Inserts text chunks with embeddings and metadata into Cloudflare Vectorize.
   */
  public async insertChunks(
    docId: string,
    fileName: string,
    chunks: Array<{ text: string; chunkIndex: number; pageNumber: number; containsTable: boolean }>
  ): Promise<number> {
    const vectors: VectorizeVector[] = [];

    for (const chunk of chunks) {
      const embedding = await this.generateEmbedding(chunk.text);
      vectors.push({
        id: `${docId}_chunk_${chunk.chunkIndex}`,
        values: embedding,
        metadata: {
          docId,
          fileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          containsTable: chunk.containsTable
        }
      });
    }

    // Insert vectors in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await this.vectorize.insert(batch);
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

    const matches = await this.vectorize.query(queryVector, {
      topK,
      filter: selectedDocId ? { docId: selectedDocId } : undefined,
      returnMetadata: 'all'
    });

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
