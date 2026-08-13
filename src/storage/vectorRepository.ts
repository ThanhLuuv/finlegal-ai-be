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
   * Generates single text embedding using BGE-M3 model ONLY (Flow A §8 & Flow B §12)
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const modelName = '@cf/baai/bge-m3';
    let attempts = 0;
    while (attempts < 3) {
      try {
        const res = await (this.ai as any).run(modelName, { text: [text] });
        if (res && res.data && res.data[0]) {
          return res.data[0];
        }
      } catch (err) {
        attempts++;
        if (attempts >= 3) {
          throw new Error(`EMBEDDING_FAILED: Failed to generate vector using ${modelName} after 3 attempts: ${String(err)}`);
        }
        await new Promise(r => setTimeout(r, 400 * attempts));
      }
    }
    throw new Error(`EMBEDDING_FAILED: ${modelName} returned empty embedding.`);
  }

  /**
   * Generates batch embeddings in parallel using BGE-M3 model ONLY
   */
  public async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batchSize = 20;
    const batches: string[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }

    const modelName = '@cf/baai/bge-m3';
    const batchResults = await Promise.all(
      batches.map(async (batchTexts) => {
        const res = await (this.ai as any).run(modelName, { text: batchTexts });
        if (res && res.data && Array.isArray(res.data)) {
          return res.data;
        }
        throw new Error(`EMBEDDING_FAILED: Batch embedding failed for ${modelName}`);
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
      values: embeddings[idx],
      metadata: {
        docId: chunk.documentId,
        tenantId: chunk.tenantId || chunk.metadata.tenantId || 'tenant_default',
        fileName: chunk.metadata.fileName,
        pageStart: chunk.pageStart || 1,
        pageEnd: chunk.pageEnd || 1,
        sectionTitle: chunk.metadata.sectionTitle || '',
        sectionPath: chunk.metadata.sectionPath ? JSON.stringify(chunk.metadata.sectionPath) : '[]',
        chunkIndex: chunk.metadata.chunkIndex,
        chunkType: chunk.chunkType,
        text: chunk.content.slice(0, 1000), // Preserves text in metadata safely
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
   * Queries Vectorize with mandatory metadata filtering when targetDocId or tenantId is specified
   */
  public async queryVectorMatches(
    queryText: string,
    topK = 20,
    selectedDocId?: string,
    tenantId?: string
  ): Promise<Array<{
    chunkId: string;
    score: number;
    text: string;
    metadata: ChunkMetadata;
  }>> {
    const queryVector = await this.generateEmbedding(queryText);

    const filterObj: Record<string, string> = {};
    if (selectedDocId) filterObj.docId = selectedDocId;
    if (tenantId && tenantId !== 'tenant_default') filterObj.tenantId = tenantId;

    const matches = await this.vectorize.query(queryVector, {
      topK,
      filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
      returnMetadata: 'all'
    });

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

