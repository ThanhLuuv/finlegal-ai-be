// Advanced RAG Agent (Vector Retrieval + Lexical Keyword Reranking & Structured Citations)

import { BaseAgent } from './base';
import { AgentRole, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';
import { RagService } from '../rag/ragService';
import { VectorRepository } from '../storage/vectorRepository';

import { D1DocumentRepository } from '../storage/d1DocumentRepository';

export class AdvancedRAGAgent extends BaseAgent {
  public role: AgentRole = 'RAG_AGENT';
  private ragService: RagService;

  constructor(llm: LLMProviderService, vectorRepo: VectorRepository, d1Repo?: D1DocumentRepository) {
    super(llm);
    this.ragService = new RagService(vectorRepo, llm, d1Repo);
  }



  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Executing Vector Retrieval & Lexical Reranking with Metadata Filtering...');

    try {
      const ragResult = await this.ragService.retrieveEvidence(
        state.userPrompt,
        state.selectedDocId
      );

      state.ragContext = ragResult.formattedContext;
      (state as any).ragResult = ragResult; // Attach structured RetrievalResult

      const preview = ragResult.evidence
        .map(e => `[${e.citation.documentName} | ${e.citation.sectionTitle || 'Section'} | Trang ${e.citation.pageStart}]: ${e.content.slice(0, 90)}...`)
        .join('\n');

      this.recordThought(
        state,
        `Retrieved ${ragResult.evidence.length} structured evidence blocks.`,
        {
          chunksRetrieved: ragResult.evidence.length,
          hasSufficientEvidence: ragResult.hasSufficientEvidence,
          chunksPreview: preview
        }
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordThought(state, `Vector retrieval notice: ${errorMsg}`, { warning: errorMsg });
      state.ragContext = 'KHÔNG CÓ DỮ LIỆU TÌM THẤY.';
    }

    return state;
  }
}


