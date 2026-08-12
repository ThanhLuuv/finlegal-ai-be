// Pure Vector Retriever with Metadata Filtering

import { VectorRepository } from '../storage/vectorRepository';
import { QueryAnalysis } from './types';
import { stripPDFSyntaxNoise, isPDFSyntaxChunk, isBinaryNoise } from '../document/extraction/legacyPdfExtractor';
import { ChunkMetadata } from '../document/types';

export interface RawRetrievedMatch {
  chunkId: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

export class VectorRetriever {
  private vectorRepo: VectorRepository;

  constructor(vectorRepo: VectorRepository) {
    this.vectorRepo = vectorRepo;
  }

  public async retrieve(query: QueryAnalysis, topK = 8): Promise<RawRetrievedMatch[]> {
    const rawMatches = await this.vectorRepo.queryVectorMatches(
      query.rewrittenQuery,
      topK,
      query.targetDocId
    );

    // Sanitize retrieved matches and eliminate legacy PDF syntax noise chunks
    return rawMatches
      .map(m => ({
        ...m,
        text: stripPDFSyntaxNoise(m.text)
      }))
      .filter(m => m.text.trim().length > 10 && !isPDFSyntaxChunk(m.text) && !isBinaryNoise(m.text));
  }
}
