// Cloudflare R2 Storage Repository (Original Files & Chunk Texts Pointer Storage)

export class R2DocumentRepository {
  private r2: R2Bucket;

  constructor(r2: R2Bucket) {
    this.r2 = r2;
  }

  /**
   * Uploads raw original document binary arrayBuffer to R2
   */
  public async uploadDocument(docId: string, fileName: string, buffer: ArrayBuffer): Promise<string> {
    const key = `documents/${docId}/${fileName}`;
    await this.r2.put(key, buffer, {
      httpMetadata: { contentType: 'application/octet-stream' }
    });
    return key;
  }

  /**
   * Stores long chunk text content in R2 as a pointer fallback
   */
  public async uploadChunkText(docId: string, chunkId: string, content: string): Promise<string> {
    const key = `chunks/${docId}/${chunkId}.txt`;
    await this.r2.put(key, content, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' }
    });
    return key;
  }

  /**
   * Retrieves chunk text content from R2
   */
  public async getChunkText(r2ChunkKey: string): Promise<string | null> {
    try {
      const obj = await this.r2.get(r2ChunkKey);
      if (!obj) return null;
      return await obj.text();
    } catch {
      return null;
    }
  }

  /**
   * Synchronized Idempotent Deletion of original document and chunk blobs from R2
   */
  public async deleteDocumentAndChunks(docId: string, r2Key?: string): Promise<void> {
    if (r2Key) {
      try { await this.r2.delete(r2Key); } catch {}
    }

    try {
      const list = await this.r2.list({ prefix: `chunks/${docId}/` });
      for (const obj of list.objects) {
        await this.r2.delete(obj.key);
      }
    } catch {}
  }
}
