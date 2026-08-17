// Cloud Run Remote Document Processing Client with Graceful Local Worker Fallback

export interface CloudRunParsedPage {
  pageNumber: number;
  text: string;
  method: string;
  qualityScore: number;
}

export interface CloudRunParsedDocument {
  documentId: string;
  pages: CloudRunParsedPage[];
  fullText: string;
  tables: any[];
  metadata: {
    pageCount: number;
    totalWords?: number;
    totalChars?: number;
    latencyMs?: number;
    methodsUsed?: Record<string, number>;
  };
}

export class DocumentServiceClient {
  private serviceUrl?: string;
  private secretToken?: string;

  constructor(serviceUrl?: string, secretToken?: string) {
    this.serviceUrl = serviceUrl?.trim().replace(/\/+$/, '');
    this.secretToken = secretToken?.trim();
  }

  public isConfigured(): boolean {
    return Boolean(this.serviceUrl && this.serviceUrl.length > 0);
  }

  /**
   * Sends R2 Signed URL to Google Cloud Run Document Service /extract
   */
  public async extractFromUrl(documentId: string, fileUrl: string, fileName?: string): Promise<CloudRunParsedDocument | null> {
    if (!this.isConfigured()) return null;

    try {
      console.log(`[Cloud Run Service] Sending extraction request for docId=${documentId} to ${this.serviceUrl}/extract...`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (this.secretToken) {
        headers['x-api-token'] = this.secretToken;
      }

      const res = await fetch(`${this.serviceUrl}/extract`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          documentId,
          fileUrl,
          fileName
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[Cloud Run Notice] HTTP ${res.status}: ${errText}. Falling back to local extractor...`);
        return null;
      }

      const data = (await res.json()) as CloudRunParsedDocument;
      console.log(`[Cloud Run Complete] Extracted ${data.metadata.pageCount} pages, ${data.fullText.length} chars in ${data.metadata.latencyMs || 0}ms.`);
      return data;
    } catch (err) {
      console.warn('[Cloud Run Service Unreachable] Falling back to local worker extractor:', err);
      return null;
    }
  }

  /**
   * Sends binary buffer directly to Google Cloud Run /extract/file endpoint
   */
  public async extractFromFile(documentId: string, buffer: ArrayBuffer, fileName: string): Promise<CloudRunParsedDocument | null> {
    if (!this.isConfigured()) return null;

    try {
      console.log(`[Cloud Run Service] Sending direct binary upload for docId=${documentId} to ${this.serviceUrl}/extract/file...`);
      
      const formData = new FormData();
      formData.append('documentId', documentId);
      formData.append('file', new Blob([buffer]), fileName);

      const headers: Record<string, string> = {};
      if (this.secretToken) {
        headers['x-api-token'] = this.secretToken;
      }

      const res = await fetch(`${this.serviceUrl}/extract/file`, {
        method: 'POST',
        headers,
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[Cloud Run Notice] HTTP ${res.status}: ${errText}. Falling back to local extractor...`);
        return null;
      }

      const data = (await res.json()) as CloudRunParsedDocument;
      return data;
    } catch (err) {
      console.warn('[Cloud Run Service Unreachable] Falling back to local worker extractor:', err);
      return null;
    }
  }
}
