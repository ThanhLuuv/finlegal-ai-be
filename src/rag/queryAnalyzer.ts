// RAG Query Analyzer
// Extracts search terms, keywords, and document filters from user prompts

import { QueryAnalysis } from './types';

export class QueryAnalyzer {
  public analyze(prompt: string, selectedDocId?: string): QueryAnalysis {
    const cleanPrompt = (prompt || '').trim();
    
    // Extract keywords (length > 2)
    const keywords = cleanPrompt
      .toLowerCase()
      .replace(/[^\w\sÀ-ỹ0-9]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 2);

    return {
      originalQuery: cleanPrompt,
      rewrittenQuery: cleanPrompt,
      keywords,
      targetDocId: selectedDocId
    };
  }
}
