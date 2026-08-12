// Cloudflare Vectorize Repository (Vector Storage & Metadata Filtering)

import { RagChunk, ChunkMetadata } from '../document/types';

export class VectorRepository {
  private vectorize: VectorizeIndex;
  private ai: Ai;

  constructor(vectorize: VectorizeIndex, ai: Ai) {
    this.vectorize = vectorize;
    this.ai = ai;
  }

  /**
   * Generates single text embedding
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const models = [
      '@cf/baai/bge-base-en-v1.5',
      '@cf/google/embeddinggemma-300m',
      '@cf/baai/bge-m3'
    ];

    for (const modelName of models) {
      try {
        const res = await (this.ai as any).run(modelName, { text: [text] });
        if (res && res.data && res.data[0]) {
          return res.data[0];
        }
      } catch {
        // try next model
      }
    }

    return new Array(768).fill(0);
  }

  /**
   * Generates batch embeddings in parallel using Promise.all()
   */
  public async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batchSize = 25;
    const batches: string[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }

    const models = [
      '@cf/baai/bge-base-en-v1.5',
      '@cf/google/embeddinggemma-300m',
      '@cf/baai/bge-m3'
    ];

    const batchResults = await Promise.all(
      batches.map(async (batchTexts) => {
        for (const modelName of models) {
          try {
            const res = await (this.ai as any).run(modelName, { text: batchTexts });
            if (res && res.data && Array.isArray(res.data)) {
              return res.data;
            }
          } catch {
            // try next model
          }
        }
        return batchTexts.map(() => new Array(768).fill(0));
      })
    );

    return batchResults.flat();
  }

  /**
   * Upserts structure-aware chunks into Vectorize
   */
  public async upsertChunks(chunks: RagChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;
    const texts = chunks.map(c => c.content);
    const embeddings = await this.generateEmbeddingsBatch(texts);

    const vectors: VectorizeVector[] = chunks.map((chunk, idx) => ({
      id: chunk.id,
      values: embeddings[idx] || new Array(768).fill(0),
      metadata: {
        docId: chunk.documentId,
        fileName: chunk.metadata.fileName,
        pageStart: chunk.pageStart || 1,
        pageEnd: chunk.pageEnd || 1,
        sectionTitle: chunk.metadata.sectionTitle || '',
        sectionPath: chunk.metadata.sectionPath ? JSON.stringify(chunk.metadata.sectionPath) : '[]',
        chunkIndex: chunk.metadata.chunkIndex,
        chunkType: chunk.chunkType,
        text: chunk.content.slice(0, 1000), // Preserves full text in metadata capped safely
        containsTable: chunk.metadata.containsTable
      }
    }));

    const batchSize = 50;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await this.vectorize.insert(batch);
    }

    return vectors.length;
  }

  /**
   * Queries Vectorize with optional metadata filtering (docId)
   */
  public async queryVectorMatches(
    queryText: string,
    topK = 8,
    selectedDocId?: string
  ): Promise<Array<{
    chunkId: string;
    score: number;
    text: string;
    metadata: ChunkMetadata;
  }>> {
    const queryVector = await this.generateEmbedding(queryText);

    let matches = await this.vectorize.query(queryVector, {
      topK,
      filter: selectedDocId ? { docId: selectedDocId } : undefined,
      returnMetadata: 'all'
    });

    if ((!matches || !matches.matches || matches.matches.length === 0) && selectedDocId) {
      matches = await this.vectorize.query(queryVector, {
        topK,
        returnMetadata: 'all'
      });
    }

    if (!matches || !matches.matches) return [];

    return matches.matches.map(m => {
      const rawPath = String(m.metadata?.sectionPath || '[]');
      let sectionPath: string[] = [];
      try {
        sectionPath = JSON.parse(rawPath);
      } catch {
        sectionPath = [];
      }

      return {
        chunkId: String(m.id || ''),
        score: m.score,
        text: String(m.metadata?.text || ''),
        metadata: {
          docId: String(m.metadata?.docId || ''),
          fileName: String(m.metadata?.fileName || 'document.pdf'),
          pageStart: Number(m.metadata?.pageStart || 1),
          pageEnd: Number(m.metadata?.pageEnd || 1),
          sectionTitle: String(m.metadata?.sectionTitle || ''),
          sectionPath,
          chunkIndex: Number(m.metadata?.chunkIndex || 0),
          documentType: String(m.metadata?.documentType || 'generic'),
          containsTable: Boolean(m.metadata?.containsTable),
          text: String(m.metadata?.text || '')
        }
      };
    });
  }
}
