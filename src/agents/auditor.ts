// Risk Auditor Agent (Cross-Checker & Discrepancy Detector)

import { BaseAgent } from './base';
import { AgentRole, AuditReport, MultiAgentState } from './state';
import { LLMProviderService } from '../services/llm';

export class RiskAuditorAgent extends BaseAgent {
  public role: AgentRole = 'AUDITOR';

  constructor(llm: LLMProviderService) {
    super(llm);
  }

  public async execute(state: MultiAgentState): Promise<MultiAgentState> {
    this.recordThought(state, 'Cross-verifying PDF document claims against D1 Database sales records...');

    const ragContextText = (state.ragContext || [])
      .map(c => `[Source: ${c.source}, Page ${c.page}]:\n${c.text}`)
      .join('\n\n');

    const sqlResultsJson = JSON.stringify(state.sqlResult || [], null, 2);

    try {
      const auditAnalysis = await this.llm.generateJSON<{
        discrepancyFound: boolean;
        pdfClaim: string;
        dbRecord: string;
        varianceUsd?: number;
        variancePercentage?: number;
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';
        explanation: string;
        finalAnswer: string;
      }>([
        {
          role: 'system',
          content: `You are the Chief Risk Auditor Agent of FinLegal AI.
Your objective is to compare financial & legal terms specified in PDF contracts (RAG Context) against actual system transactional data recorded in the relational database (SQL Results).

EVALUATION RULES:
1. Identify exact figures, numbers, dates, terms, or candidate information in both sources.
2. If there is a mismatch (e.g. Contract specifies $150,000 but DB records $120,000), set "discrepancyFound": true, calculate varianceUsd and variancePercentage, and assign "riskLevel" ("HIGH" for > 15% variance or critical clause mismatch, "MEDIUM" for 5-15%, "LOW" for < 5%, "NONE" for exact match or general Q&A).
3. BẮT BUỘC trả lời 100% bằng TIẾNG VIỆT (VIETNAMESE ONLY). Trình bày chuyên nghiệp, ngắn gọn và rõ ràng.

Return JSON format:
{
  "discrepancyFound": boolean,
  "pdfClaim": "Text summary of PDF claim",
  "dbRecord": "Text summary of DB record",
  "varianceUsd": number or null,
  "variancePercentage": number or null,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "NONE",
  "explanation": "Detailed technical analysis",
  "finalAnswer": "Markdown formatted response for the user in VIETNAMESE"
}`
        },
        {
          role: 'user',
          content: `USER QUESTION: ${state.userPrompt}

--- EXTRACTED PDF CLAUSES (RAG CONTEXT) ---
${ragContextText || 'No PDF context available.'}

--- ACTUAL SYSTEM DB RECORDS (SQL RESULT) ---
${sqlResultsJson || 'No DB records available.'}`
        }
      ]);

      state.auditReport = {
        discrepancyFound: auditAnalysis.discrepancyFound,
        pdfClaim: auditAnalysis.pdfClaim,
        dbRecord: auditAnalysis.dbRecord,
        varianceUsd: auditAnalysis.varianceUsd,
        variancePercentage: auditAnalysis.variancePercentage,
        riskLevel: auditAnalysis.riskLevel,
        explanation: auditAnalysis.explanation
      };

      state.finalAnswer = auditAnalysis.finalAnswer;

      this.recordThought(
        state, 
        `Audit completed. Discrepancy Found: ${auditAnalysis.discrepancyFound ? 'YES' : 'NO'} | Risk Level: [${auditAnalysis.riskLevel}]`, 
        state.auditReport
      );
    } catch (auditorErr) {
      console.warn('RiskAuditorAgent JSON parse failed, calling text generation fallback...');
      const fallbackText = await this.llm.generateText([
        {
          role: 'system',
          content: 'Bạn là Trợ lý AI FinLegal AI. Bạn BẮT BUỘC phải tổng hợp và phản hồi bằng TIẾNG VIỆT 100% định dạng Markdown.'
        },
        {
          role: 'user',
          content: `Văn bản PDF: ${ragContextText || 'Không tìm thấy'}\n\nDữ liệu hệ thống: ${sqlResultsJson || 'Không có'}\n\nCâu hỏi: ${state.userPrompt}`
        }
      ]);
      state.finalAnswer = fallbackText;
      this.recordThought(state, 'Audit report generated via natural language synthesis.');
    }

    return state;
  }
}
