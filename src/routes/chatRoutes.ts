// Stage 2 Query Pipeline Routes - Real-time SSE Multi-Agent Engine

import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { Bindings } from '../index';
import { MultiAgentState } from '../core/types';
import { RetrievalScope } from '../core/types';
import { SupervisorRouter } from '../core/routing/supervisor';
import { SQLToolAgent } from '../core/tools/sqlAgent';
import { LLMProviderService } from '../services/llm';
import { D1DatabaseService } from '../services/d1';
import { VectorRepository } from '../storage/vectorRepository';
import { D1DocumentRepository } from '../storage/d1DocumentRepository';
import { LangfuseLogger } from '../utils/langfuse';
import { HybridRetriever } from '../core/retrieval/hybridRetriever';
import { BgeReranker } from '../core/retrieval/bgeReranker';
import { GroundedSynthesizer } from '../core/synthesis/synthesizer';

export const chatRoutes = new Hono<{ Bindings: Bindings }>();

// Real-time Stage 2 Query Pipeline Handler (Rewrite -> Hybrid Retrieval -> RRF -> BGE Rerank Top 3-5 -> Grounded Synthesis)
chatRoutes.post('/stream', async (c) => {
  const startTime = Date.now();
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'INVALID_JSON: Failed to parse request body as JSON' }, 400);
  }

  // Runtime Type Guard Validation (Zero-bloat edge security)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'INVALID_PAYLOAD: Request body must be a valid JSON object' }, 400);
  }
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return c.json({ error: 'INVALID_INPUT: prompt must be a non-empty string' }, 400);
  }
  if (body.docId !== undefined && typeof body.docId !== 'string') {
    return c.json({ error: 'INVALID_INPUT: docId must be a string if provided' }, 400);
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return c.json({ error: 'INVALID_INPUT: sessionId must be a string if provided' }, 400);
  }

  // Server-Side Tenant Resolution (Security Boundary: Never trust client payload tenantId)
  const tenantId = c.req.header('x-tenant-id') || 'tenant_default';
  const userId = c.req.header('x-user-id') || 'user_default';

  const prompt = body.prompt;
  const docId = body.docId;
  const sessionId = body.sessionId || crypto.randomUUID();
  const traceId = crypto.randomUUID();
  const history = Array.isArray(body.history) ? body.history : [];

  // IP Rate Limiting Check (5 Requests / 10 Minutes per IP)
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const now = Date.now();
  const WINDOW_MS = 10 * 60 * 1000;
  const MAX_REQUESTS = 5;

  try {
    const record = await c.env.DB.prepare('SELECT request_count, reset_at FROM ip_rate_limits WHERE ip = ?').bind(clientIp).first<{ request_count: number; reset_at: number }>();
    if (record) {
      if (now > record.reset_at) {
        await c.env.DB.prepare('UPDATE ip_rate_limits SET request_count = 1, reset_at = ? WHERE ip = ?').bind(now + WINDOW_MS, clientIp).run();
      } else if (record.request_count >= MAX_REQUESTS) {
        const minutesLeft = Math.ceil((record.reset_at - now) / 60000);
        return c.json({
          error: `Hệ thống bảo vệ tự động: Địa chỉ IP của bạn đã dùng hết 5 lượt hỏi trong 10 phút để tránh rủi ro quá tải. Vui lòng quay lại sau ${minutesLeft} phút!`
        }, 429);
      } else {
        await c.env.DB.prepare('UPDATE ip_rate_limits SET request_count = request_count + 1 WHERE ip = ?').bind(clientIp).run();
      }
    } else {
      await c.env.DB.prepare('INSERT INTO ip_rate_limits (ip, request_count, reset_at) VALUES (?, 1, ?)').bind(clientIp, now + WINDOW_MS).run();
    }
  } catch (rateErr) {
    console.warn('Rate limiting check warning:', rateErr);
  }

  // Initialize Core Services & Pipeline Components
  const apiKey = c.env.DEEPSEEK_API_KEY || c.env.GEMINI_API_KEY || c.env.OPENAI_API_KEY;
  const llm = new LLMProviderService(c.env.AI, apiKey);
  const d1Service = new D1DatabaseService(c.env.DB);
  const d1Repo = new D1DocumentRepository(c.env.DB);
  const vectorRepo = new VectorRepository(c.env.VECTORIZE, c.env.AI);
  const langfuse = new LangfuseLogger(c.env.LANGFUSE_PUBLIC_KEY, c.env.LANGFUSE_SECRET_KEY, c.env.LANGFUSE_HOST);

  const supervisor = new SupervisorRouter(llm);
  const sqlAgent = new SQLToolAgent(llm, d1Service);
  const hybridRetriever = new HybridRetriever(vectorRepo, d1Repo);
  const reranker = new BgeReranker(c.env.AI);
  const synthesizer = new GroundedSynthesizer(llm);

  return streamText(c, async (stream) => {
    const sendEvent = async (event: string, data: any) => {
      await stream.writeln(`event: ${event}`);
      await stream.writeln(`data: ${JSON.stringify(data)}`);
      await stream.writeln('');
    };

    let state: MultiAgentState = {
      sessionId,
      traceId,
      userPrompt: prompt,
      selectedDocId: docId,
      thoughtProcess: [],
      finalAnswer: ''
    };

    await sendEvent('status', { phase: 'STARTED', traceId, sessionId });

    const sendSanitizedThought = async (step?: any) => {
      if (!step) return;
      await sendEvent('thought', {
        agent: step.agent,
        status: step.status,
        thought: step.thought,
        timestamp: step.timestamp
      });
    };

    try {
      // Step 1: Supervisor Intent Routing
      state = await supervisor.routeIntent(state);
      await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);

      const intent = state.intent || 'RAG_ONLY';

      // Execute SQL Tool if needed
      if (intent === 'SQL_ONLY' || intent === 'HYBRID_AUDIT') {
        state = await sqlAgent.execute(state);
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      // Step 2 & 3: Hybrid Retrieval & Reranking if RAG_ONLY or HYBRID_AUDIT
      let topEvidenceBlocks: any[] = [];
      if (intent === 'RAG_ONLY' || intent === 'HYBRID_AUDIT') {
        state.thoughtProcess.push({
          agent: 'RAG_AGENT',
          status: 'EXECUTING',
          thought: 'Đang truy vấn Hybrid (Dense Vectorize + Sparse D1 SQL)...',
          timestamp: Date.now()
        });
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);

        // Extract keywords
        const keywords = prompt.toLowerCase().replace(/[^\w\sÀ-ỹ0-9]/g, ' ').split(/\s+/).filter((k: string) => k.length > 1);

        // 1. Hybrid Retrieval (Vectorize Top 25 + D1 Sparse) -> RRF Merge
        const candidates = await hybridRetriever.retrieveCandidates(prompt, keywords, docId, 25, 20);

        // 2. BGE Reranker -> Select Dynamic Top-K candidates (Top 4-10)
        const dynamicTopK = hybridRetriever.determineDynamicTopK(prompt);
        topEvidenceBlocks = await reranker.rerank(prompt, candidates, dynamicTopK);

        state.thoughtProcess.push({
          agent: 'RAG_AGENT',
          status: 'DONE',
          thought: `Đã dung hợp và Rerank được ${topEvidenceBlocks.length} đoạn trích dẫn chất lượng cao nhất (Dynamic Top-${dynamicTopK}).`,
          timestamp: Date.now()
        });
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      // Step 4: Grounded LLM Answer Synthesis
      if (intent === 'HYBRID_AUDIT' || intent === 'RAG_ONLY' || intent === 'SQL_ONLY') {
        const sqlData = state.sqlResult || state.sqlData;
        const result = await synthesizer.synthesize(prompt, topEvidenceBlocks, intent, sqlData);

        state.finalAnswer = result.answer;
        state.citations = result.citations;
        if (result.auditReport) {
          state.auditReport = result.auditReport;
        }
      } else {
        // General Chat
        const generalReply = await llm.generateText([
          {
            role: 'system',
            content: 'Bạn là Trợ lý AI Lexifin chuyên phân tích Hợp đồng và Đối soát Số liệu Bán hàng Doanh nghiệp. Bạn BẮT BUỘC phải trả lời bằng Tiếng Việt 100%, lịch sự, chuyên nghiệp và ngắn gọn.'
          },
          { role: 'user', content: prompt }
        ]);
        state.finalAnswer = generalReply;
      }

      // Stream Audit Report Card data if present
      if (state.auditReport) {
        await sendEvent('audit_report', state.auditReport);
      }

      // Stream Final Answer to Frontend
      await sendEvent('final_answer', {
        answer: state.finalAnswer,
        thoughtProcess: state.thoughtProcess,
        auditReport: state.auditReport,
        citations: state.citations
      });

      await sendEvent('status', { phase: 'COMPLETED' });

      // Save trace log into D1 Database
      c.executionCtx.waitUntil(
        d1Service.saveChatLog({
          sessionId,
          traceId,
          userPrompt: prompt,
          intent: state.intent || 'UNKNOWN',
          thoughtProcess: JSON.stringify(state.thoughtProcess),
          finalResponse: state.finalAnswer,
          riskLevel: state.auditReport?.riskLevel || 'NONE'
        })
      );

      // Log Telemetry to Langfuse
      c.executionCtx.waitUntil(
        langfuse.logTrace({
          traceId,
          sessionId,
          userPrompt: prompt,
          intent: state.intent || 'UNKNOWN',
          thoughtSteps: state.thoughtProcess,
          finalAnswer: state.finalAnswer,
          latencyMs: Date.now() - startTime
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await sendEvent('error', { message: errorMsg });
    }
  });
});
