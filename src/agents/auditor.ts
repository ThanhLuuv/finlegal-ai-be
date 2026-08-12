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

    const ragContextText = typeof state.ragContext === 'string'
      ? state.ragContext
      : (state.ragContext || [])
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
          content: `You are the Chief Risk Auditor Agent & Enterprise AI Assistant of FinLegal AI.
Your objective is to analyze the user question, inspect the PDF Document Context (RAG Context), and cross-check with Database Records (SQL Results).

RESPONSE RULES:
1. If the user asks a direct question about the PDF (e.g. "Tên ứng viên là gì?", "Điều khoản hợp đồng ghi bao nhiêu?", "Kinh nghiệm làm việc ra sao?"), ANSWER THE QUESTION DIRECTLY AND PRECISELY IN VIETNAMESE based on the PDF context.
2. If comparing financial figures against DB and there is a mismatch, set "discrepancyFound": true and assign "riskLevel" ("HIGH", "MEDIUM", "LOW").
3. If no discrepancy exists or if it is a general document Q&A question, set "discrepancyFound": false, "riskLevel": "NONE".
4. BẮT BUỘC TRẢ LỜI 100% BẰNG TIẾNG VIỆT CHUYÊN NGHIỆP TRONG "finalAnswer". Không trả lời câu tiếng Anh hay câu dịch gượng ép ("Không tình yêu...").

Return JSON format:
{
  "discrepancyFound": boolean,
  "pdfClaim": "Text summary of PDF claim or candidate info",
  "dbRecord": "Text summary of DB record or system data",
  "varianceUsd": number or null,
  "variancePercentage": number or null,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "NONE",
  "explanation": "Detailed technical analysis in Vietnamese",
  "finalAnswer": "Direct, clear, Markdown-formatted answer in VIETNAMESE"
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
