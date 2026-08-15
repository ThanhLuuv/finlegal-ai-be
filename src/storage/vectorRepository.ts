// Cloudflare Vectorize Repository (Vector Storage & Metadata Filtering)

import { RagChunk, ChunkMetadata, RetrievalScope } from '../core/types';

function safeTruncateText(text: string, maxChars = 2500): string {
  if (!text) return '';
  return text.length <= maxChars ? text : text.substring(0, maxChars);
}

function adjustVectorDimension(vector: number[], targetDim = 768): number[] {
  if (!vector || vector.length === 0) return new Array(targetDim).fill(0);
  if (vector.length === targetDim) return vector;

  if (vector.length > targetDim) {
    const sliced = vector.slice(0, targetDim);
    const norm = Math.sqrt(sliced.reduce((sum, val) => sum + val * val, 0)) || 1;
    return sliced.map(val => val / norm);
  }

  return [...vector, ...new Array(targetDim - vector.length).fill(0)];
}

export class VectorRepository {
  private vectorize: VectorizeIndex;
  private ai: Ai;

  constructor(vectorize: VectorizeIndex, ai: Ai) {
    this.vectorize = vectorize;
    this.ai = ai;
  }

  /**
   * Generates single text embedding using 768-dim compatible models (Flow A §8 & Flow B §12)
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const models = ['@cf/baai/bge-base-en-v1.5', '@cf/baai/bge-m3', '@cf/google/embeddinggemma-300m'];
    const safeText = safeTruncateText(text, 2500);

    for (const modelName of models) {
      try {
        const res = await (this.ai as any).run(modelName, { text: [safeText] });
        if (res && res.data && res.data[0]) {
          return adjustVectorDimension(res.data[0], 768);
        }
      } catch {
        // try next model
      }
    }

    throw new Error('EMBEDDING_FAILED: All embedding models failed.');
  }

  /**
   * Generates batch embeddings in parallel using 768-dim compatible models
   */
  public async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batchSize = 20;
    const batches: string[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }

    const models = ['@cf/baai/bge-base-en-v1.5', '@cf/baai/bge-m3', '@cf/google/embeddinggemma-300m'];
    const batchResults = await Promise.all(
      batches.map(async (batchTexts) => {
        const safeBatch = batchTexts.map(t => safeTruncateText(t, 2500));
        for (const modelName of models) {
          try {
            const res = await (this.ai as any).run(modelName, { text: safeBatch });
            if (res && res.data && Array.isArray(res.data)) {
              return res.data.map((v: number[]) => adjustVectorDimension(v, 768));
            }
          } catch {
            // try next model
          }
        }
        return safeBatch.map(() => new Array(768).fill(0));
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

    const vectors: VectorizeVector[] = chunks.map((chunk, idx) => {
      const safeId = chunk.id.length <= 60 ? chunk.id : chunk.id.substring(0, 60);
      return {
        id: safeId,
        values: embeddings[idx],
        metadata: {
          docId: chunk.documentId,
          tenantId: chunk.tenantId || 'tenant_default',
          fileName: (chunk.metadata.fileName || 'document.pdf').slice(0, 200),
          pageStart: chunk.pageStart || 1,
          pageEnd: chunk.pageEnd || 1,
          sectionTitle: (chunk.metadata.sectionTitle || '').slice(0, 200),
          sectionPath: (chunk.metadata.sectionPath ? JSON.stringify(chunk.metadata.sectionPath) : '[]').slice(0, 500),
          chunkIndex: chunk.metadata.chunkIndex,
          chunkType: chunk.chunkType,
          text: chunk.content.slice(0, 1000), // Preserves text in metadata safely
          containsTable: Boolean(chunk.metadata.containsTable)
        }
      };
    });

    const batchSize = 50;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      try {
        await (this.vectorize as any).upsert(batch);
      } catch {
        await this.vectorize.insert(batch);
      }
    }

    return vectors.length;

    return vectors.length;
  }

  /**
   * Deletes document vectors from Vectorize index by exact IDs (Flow C §20)
   */
  public async deleteByIds(vectorIds: string[]): Promise<void> {
    if (!vectorIds || vectorIds.length === 0) return;
    const batchSize = 100;
    for (let i = 0; i < vectorIds.length; i += batchSize) {
      const batch = vectorIds.slice(i, i + batchSize);
      await this.vectorize.deleteByIds(batch);
    }
  }

  /**
   * Queries Vectorize with mandatory metadata filtering using RetrievalScope
   */
  public async queryVectorMatches(
    queryText: string,
    topK = 20,
    scope?: RetrievalScope | string,
    tenantId?: string
  ): Promise<Array<{
    chunkId: string;
    score: number;
    text: string;
    metadata: ChunkMetadata;
  }>> {
    const queryVector = await this.generateEmbedding(queryText);

    const filterObj: Record<string, string> = {};

    if (typeof scope === 'object' && scope) {
      if (scope.documentIds && scope.documentIds.length === 1) {
        filterObj.docId = scope.documentIds[0];
      }
      if (scope.tenantId && scope.tenantId !== 'tenant_default') {
        filterObj.tenantId = scope.tenantId;
      }
    } else if (typeof scope === 'string') {
      if (scope) filterObj.docId = scope;
      if (tenantId && tenantId !== 'tenant_default') filterObj.tenantId = tenantId;
    }

    let matches = await this.vectorize.query(queryVector, {
      topK,
      filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
      returnMetadata: 'all'
    });

    if (!matches || !matches.matches) return [];

    // Enforce strict docId scope filtering if documentIds was specified
    const targetDocId = filterObj.docId;
    let filteredMatches = matches.matches;
    if (targetDocId) {
      filteredMatches = matches.matches.filter(m => String(m.metadata?.docId || '') === targetDocId);
    }


    return filteredMatches.map(m => {
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

