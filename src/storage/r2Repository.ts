// Cloudflare R2 Storage Repository

export class R2DocumentRepository {
  private r2: R2Bucket;

  constructor(r2: R2Bucket) {
    this.r2 = r2;
  }

  /**
   * Uploads raw PDF binary arrayBuffer to R2
   */
  public async uploadDocument(docId: string, fileName: string, buffer: ArrayBuffer): Promise<string> {
    const key = `documents/${docId}/${fileName}`;
    await this.r2.put(key, buffer);
    return key;
  }

  /**
   * Deletes document from R2 storage
   */
  public async deleteDocument(r2Key: string): Promise<void> {
    await this.r2.delete(r2Key);
  }
}
