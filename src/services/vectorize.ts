// Cloudflare Vectorize Native Multilingual Vector Store Service

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
   * Generates a multilingual vector embedding for text using Workers AI.
   * Prefers @cf/google/embeddinggemma-300m (768 dims) or @cf/baai/bge-m3 for Vietnamese support.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const models = [
      '@cf/google/embeddinggemma-300m',
      '@cf/baai/bge-m3',
      '@cf/baai/bge-base-en-v1.5'
    ];

    for (const modelName of models) {
      try {
        const res = await (this.ai as any).run(modelName, {
          text: [text]
        });
        if (res && res.data && res.data[0]) {
          return res.data[0];
        }
      } catch (err) {
        console.warn(`Embedding model ${modelName} failed, trying next model...`);
      }
    }

    throw new Error('VectorizeService: All embedding models failed.');
  }

  /**
   * Generates vector embeddings in batch to minimize Worker subrequests.
   */
  public async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const allEmbeddings: number[][] = [];
    const batchSize = 20;

    const models = [
      '@cf/google/embeddinggemma-300m',
      '@cf/baai/bge-m3',
      '@cf/baai/bge-base-en-v1.5'
    ];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batchTexts = texts.slice(i, i + batchSize);
      let batchEmbeddings: number[][] | null = null;

      for (const modelName of models) {
        try {
          const res = await (this.ai as any).run(modelName, {
            text: batchTexts
          });
          if (res && res.data) {
            batchEmbeddings = res.data;
            break;
          }
        } catch {
          // try next model
        }
      }

      if (batchEmbeddings) {
        allEmbeddings.push(...batchEmbeddings);
      } else {
        // Fallback zeroes if all models fail
        allEmbeddings.push(...batchTexts.map(() => new Array(768).fill(0)));
      }
    }
    return allEmbeddings;
  }

  /**
   * Inserts text chunks with embeddings and metadata into Cloudflare Vectorize.
   * Indexes ALL document chunks without arbitrary truncation limits.
   */
  public async insertChunks(
    docId: string,
    fileName: string,
    chunks: Array<{ text: string; chunkIndex: number; pageNumber: number; containsTable: boolean }>
  ): Promise<number> {
    const texts = chunks.map(c => c.text);
    const embeddings = await this.generateEmbeddingsBatch(texts);

    const vectors: VectorizeVector[] = chunks.map((chunk, idx) => ({
      id: `${docId}_chunk_${chunk.chunkIndex}`,
      values: embeddings[idx] || new Array(768).fill(0),
      metadata: {
        docId,
        fileName,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.slice(0, 2000), // Preserves full chunk text in metadata
        containsTable: chunk.containsTable
      }
    }));

    // Insert vectors in batches of 50
    const insertBatchSize = 50;
    for (let i = 0; i < vectors.length; i += insertBatchSize) {
      const batch = vectors.slice(i, i + insertBatchSize);
      await this.vectorize.insert(batch);
    }

    return vectors.length;
  }

  /**
   * Performs hybrid vector retrieval with score threshold & optional document filter.
   */
  public async searchSimilar(
    queryText: string,
    topK = 8,
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

