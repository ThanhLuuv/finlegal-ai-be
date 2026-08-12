// Cloudflare R2 Object Storage Service Adapter

export class R2StorageService {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  /**
   * Uploads a raw PDF binary file buffer to Cloudflare R2.
   */
  public async uploadPDF(docId: string, filename: string, body: ArrayBuffer | ReadableStream): Promise<string> {
    const key = `documents/${docId}/${filename}`;
    await this.bucket.put(key, body, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { docId, filename, uploadedAt: new Date().toISOString() }
    });
    return key;
  }

  /**
   * Fetches object from Cloudflare R2 as an ArrayBuffer.
   */
  public async getFileBuffer(key: string): Promise<ArrayBuffer> {
    const object = await this.bucket.get(key);
    if (!object) {
      throw new Error(`R2 Object Not Found: Key '${key}' does not exist.`);
    }
    return await object.arrayBuffer();
  }

  /**
   * Deletes object from Cloudflare R2.
   */
  public async deleteFile(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
