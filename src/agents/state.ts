// Multi-Agent Engine State Definition & Types

export type AgentRole = 'SUPERVISOR' | 'RAG_AGENT' | 'SQL_AGENT' | 'AUDITOR';
export type AgentStatus = 'THINKING' | 'EXECUTING' | 'DONE' | 'ERROR';
export type UserIntent = 'RAG_ONLY' | 'SQL_ONLY' | 'HYBRID_AUDIT' | 'GENERAL_CHAT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';

export interface AgentThoughtStep {
  agent: AgentRole;
  status: AgentStatus;
  thought: string;
  data?: unknown;
  timestamp: number;
}

export interface RagContextChunk {
  text: string;
  source: string;
  page: number;
  score: number;
  containsTable?: boolean;
}

export interface AuditReport {
  discrepancyFound: boolean;
  pdfClaim: string;
  dbRecord: string;
  varianceUsd?: number;
  variancePercentage?: number;
  riskLevel: RiskLevel;
  explanation: string;
}

export interface MultiAgentState {
  sessionId: string;
  traceId: string;
  userPrompt: string;
  selectedDocId?: string;
  intent?: UserIntent;
  ragContext?: string | RagContextChunk[];
  sqlQuery?: string;
  sqlResult?: Record<string, unknown>[];
  sqlData?: any;
  auditReport?: AuditReport;
  thoughtProcess: AgentThoughtStep[];
  finalAnswer: string;
}

