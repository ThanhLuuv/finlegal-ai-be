// Advanced RAG Agent (Hybrid Retrieval & Keyword Boost over Cloudflare Vectorize)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { VectorizeService } from '../services/vectorize';

import { cleanPrintableText, isBinaryNoise, stripPDFSyntaxNoise, isPDFSyntaxChunk } from '../utils/pdfExtractor';

export class AdvancedRAGAgent extends BaseAgent {
  public role: AgentRole = 'RAG_AGENT';
  private vectorizeService: VectorizeService;

  constructor(llm: LLMProviderService, vectorizeService: VectorizeService) {
    super(llm);
    this.vectorizeService = vectorizeService;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Querying Cloudflare Vectorize index with Hybrid Retrieval & Multilingual Embedding...');

    try {
      const rawChunks = await this.vectorizeService.searchSimilar(
        state.userPrompt,
        8, // Retrieve top 8 vector matches
        state.selectedDocId
      );

      const sanitizedChunks = rawChunks
        .map(c => ({
          ...c,
          text: cleanPrintableText(stripPDFSyntaxNoise(c.text))
        }))
        .filter(c => c.text.trim().length > 10 && !isPDFSyntaxChunk(c.text) && !isBinaryNoise(c.text));


      // Hybrid Retrieval: Keyword Boost Reranking
      const keywords = state.userPrompt
        .toLowerCase()
        .replace(/[^\w\sÀ-ỹ0-9]/g, ' ')
        .split(/\s+/)
        .filter(k => k.length > 2);

      const rerankedChunks = sanitizedChunks.map(chunk => {
        const lowerText = chunk.text.toLowerCase();
        let keywordScoreBoost = 0;

        for (const kw of keywords) {
          if (lowerText.includes(kw)) {
            keywordScoreBoost += 0.15; // Boost score for matching keyword token
          }
        }

        return {
          ...chunk,
          score: Math.min(1.0, chunk.score + keywordScoreBoost)
        };
      });

      // Sort by final hybrid score descending
      rerankedChunks.sort((a, b) => b.score - a.score);

      state.ragContext = rerankedChunks;

      const summary = rerankedChunks
        .map(c => `[Trang ${c.page} | Score: ${(c.score * 100).toFixed(1)}%]: ${c.text.slice(0, 100)}...`)
        .join('\n');
      
      this.recordThought(
        state, 
        `Retrieved ${rerankedChunks.length} high-confidence hybrid vector & keyword chunks.`, 
        { chunksRetrieved: rerankedChunks.length, chunksPreview: summary }
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordThought(state, `Vector search warning/notice: ${errorMsg}`, { warning: errorMsg });
      state.ragContext = [];
    }

    return state;
  }
}

