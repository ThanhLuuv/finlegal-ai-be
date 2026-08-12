// Advanced RAG Agent (Hybrid Search over Cloudflare Vectorize)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { VectorizeService } from '../services/vectorize';

import { cleanPrintableText, isBinaryNoise } from '../utils/pdfExtractor';

export class AdvancedRAGAgent extends BaseAgent {
  public role: AgentRole = 'RAG_AGENT';
  private vectorizeService: VectorizeService;

  constructor(llm: LLMProviderService, vectorizeService: VectorizeService) {
    super(llm);
    this.vectorizeService = vectorizeService;
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Querying Cloudflare Vectorize index for relevant document chunks & financial tables...');

    try {
      const chunks = await this.vectorizeService.searchSimilar(
        state.userPrompt,
        5,
        state.selectedDocId
      );

      const sanitizedChunks = chunks
        .map(c => ({
          ...c,
          text: cleanPrintableText(c.text)
        }))
        .filter(c => c.text.trim().length > 3 && !isBinaryNoise(c.text));

      state.ragContext = sanitizedChunks;

      const summary = sanitizedChunks.map(c => `[Page ${c.page} | Score: ${(c.score * 100).toFixed(1)}%]: ${c.text.slice(0, 80)}...`).join('\n');
      
      this.recordThought(
        state, 
        `Retrieved ${sanitizedChunks.length} high-confidence vector chunks from document store.`, 
        { chunksRetrieved: sanitizedChunks.length, chunksPreview: summary }
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordThought(state, `Vector search warning/notice: ${errorMsg}`, { warning: errorMsg });
      state.ragContext = [];
    }

    return state;
  }
}
