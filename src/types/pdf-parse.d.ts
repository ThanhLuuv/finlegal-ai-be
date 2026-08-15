declare module 'pdf-parse' {
  interface PDFParseOptions {
    pagerender?: (pageData: any) => Promise<string> | string;
    max?: number;
    version?: string;
  }

  interface PDFParseResult {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    version: string;
    text: string;
  }

  function pdfParse(dataBuffer: Buffer | ArrayBuffer | Uint8Array, options?: PDFParseOptions): Promise<PDFParseResult>;
  export = pdfParse;
}
