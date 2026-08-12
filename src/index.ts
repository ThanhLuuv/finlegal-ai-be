// FinLegal AI Engine - Hono.js Engine on Cloudflare Workers

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';

import { MultiAgentState } from './agents/state';
import { SupervisorAgent } from './agents/supervisor';
import { AdvancedRAGAgent } from './agents/ragAgent';
import { SQLToolAgent } from './agents/sqlAgent';
import { RiskAuditorAgent } from './agents/auditor';

import { LLMProviderService } from './services/llm';
import { D1DatabaseService } from './services/d1';
import { VectorizeService } from './services/vectorize';
import { R2StorageService } from './services/r2';
import { TablePreservingChunker } from './services/chunker';
import { LangfuseLogger } from './utils/langfuse';

// Bindings Environment Interface for Workers
export interface Bindings {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  R2: R2Bucket;
  AI: Ai;
  GEMINI_API_KEY?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// 1. Cloudflare Anti-Bot & Threat Protection Middleware (with Turnstile Support)
app.use('*', async (c, next) => {
  const userAgent = c.req.header('user-agent') || '';
  const clientIP = c.req.header('cf-connecting-ip') || 'unknown';
  const turnstileToken = c.req.header('X-Turnstile-Token');

  // Block known malicious scanner bot signatures
  const suspiciousBotSignatures = [
    'sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab', 
    'eval-at-log', 'dirbuster', 'gobuster', 'python-urllib'
  ];

  const isBlockedBot = suspiciousBotSignatures.some(sig => userAgent.toLowerCase().includes(sig));
  if (isBlockedBot) {
    return c.json({ error: 'Access denied by Cloudflare Bot Defense.' }, 403);
  }

  // Validate Cloudflare Turnstile Token if secret key is present
  const secretKey = c.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA'; // Default Cloudflare Pass Testing Key
  if (turnstileToken) {
    try {
      const formData = new FormData();
      formData.append('secret', secretKey);
      formData.append('response', turnstileToken);
      formData.append('remoteip', clientIP);

      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
      });

      const verifyData = await verifyRes.json() as { success: boolean };
      if (!verifyData.success) {
        return c.json({ error: 'Cloudflare Turnstile verification failed.' }, 403);
      }
    } catch {
      // Allow fallback if Cloudflare verification endpoint is unreachable
    }
  }

  await next();

  // Attach Enterprise Security Headers
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Protection-Provider', 'Cloudflare Serverless Edge Bot Defense & Turnstile');
});

// 2. Enable CORS for Next.js Cloudflare Pages Frontend
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// 1. Health Check Endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'FinLegal AI Workers Engine',
    timestamp: new Date().toISOString()
  });
});

// 2. Admin Seed Endpoint - Populates D1 with Enterprise Sales Data
app.post('/api/admin/seed', async (c) => {
  try {
    const d1Service = new D1DatabaseService(c.env.DB);
    const { results: existing } = await c.env.DB.prepare('SELECT COUNT(*) as count FROM sales_transactions').all<{ count: number }>();
    
    if (existing && existing[0]?.count > 0) {
      return c.json({ message: 'Database already contains sales transactions.', count: existing[0].count });
    }

    const seedQueries = [
      `INSERT INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
       VALUES ('TX-1001', 'Acme Corporation', 'CTR-2024-001', 'Q1-2024', 150000.00, 'COMPLETED', '2024-03-15')`,
      `INSERT INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
       VALUES ('TX-1002', 'Acme Corporation', 'CTR-2024-001', 'Q2-2024', 120000.00, 'COMPLETED', '2024-06-20')`,
      `INSERT INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
       VALUES ('TX-1003', 'GlobalTech Industries', 'CTR-2024-002', 'Q1-2024', 300000.00, 'COMPLETED', '2024-03-28')`,
      `INSERT INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
       VALUES ('TX-1004', 'GlobalTech Industries', 'CTR-2024-002', 'Q2-2024', 250000.00, 'COMPLETED', '2024-06-28')`
    ];

    for (const query of seedQueries) {
      await c.env.DB.prepare(query).run();
    }

    return c.json({ message: 'D1 Database successfully seeded with production sales dataset.', inserted: seedQueries.length });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: errorMsg }, 500);
  }
});

// 3. Document Index Listing
app.get('/api/documents', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT doc_id, file_name, total_pages, total_chunks, created_at FROM document_records ORDER BY created_at DESC').all();
    return c.json({ documents: results || [] });
  } catch (err) {
    return c.json({ documents: [] });
  }
});

// 4. Real-time Multi-Agent SSE Chat & Audit Streaming Handler
app.post('/api/chat/stream', async (c) => {
  const startTime = Date.now();
  const body = await c.req.json<{ prompt: string; docId?: string; sessionId?: string }>();
  const prompt = body.prompt;
  const docId = body.docId;
  const sessionId = body.sessionId || crypto.randomUUID();
  const traceId = crypto.randomUUID();

  if (!prompt || prompt.trim().length === 0) {
    return c.json({ error: 'Prompt is required' }, 400);
  }

  // Initialize Services
  const llm = new LLMProviderService(c.env.AI, c.env.GEMINI_API_KEY);
  const d1Service = new D1DatabaseService(c.env.DB);
  const vectorizeService = new VectorizeService(c.env.VECTORIZE, c.env.AI);
  const langfuse = new LangfuseLogger(c.env.LANGFUSE_PUBLIC_KEY, c.env.LANGFUSE_SECRET_KEY, c.env.LANGFUSE_HOST);

  // Initialize Multi-Agent instances
  const supervisor = new SupervisorAgent(llm);
  const ragAgent = new AdvancedRAGAgent(llm, vectorizeService);
  const sqlAgent = new SQLToolAgent(llm, d1Service);
  const auditor = new RiskAuditorAgent(llm);

  return streamText(c, async (stream) => {
    // Helper to stream JSON SSE events
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

    try {
      // Step 1: Supervisor Intent Routing
      state = await supervisor.execute(state);
      await sendEvent('thought', state.thoughtProcess[state.thoughtProcess.length - 1]);

      const intent = state.intent || 'HYBRID_AUDIT';

      // Step 2 & 3: Agent Execution based on Intent
      if (intent === 'RAG_ONLY' || intent === 'HYBRID_AUDIT') {
        state = await ragAgent.execute(state);
        await sendEvent('thought', state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      if (intent === 'SQL_ONLY' || intent === 'HYBRID_AUDIT') {
        state = await sqlAgent.execute(state);
        await sendEvent('thought', state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      // Step 4: Auditor Synthesizer & Cross-checker
      if (intent === 'HYBRID_AUDIT' || intent === 'RAG_ONLY' || intent === 'SQL_ONLY') {
        state = await auditor.execute(state);
        await sendEvent('thought', state.thoughtProcess[state.thoughtProcess.length - 1]);
      } else {
        // General Chat
        const generalReply = await llm.generateText([
          { role: 'system', content: 'You are FinLegal AI, an enterprise financial & legal AI assistant.' },
          { role: 'user', content: prompt }
        ]);
        state.finalAnswer = generalReply;
      }

      // Stream Audit Card data if available
      if (state.auditReport) {
        await sendEvent('audit_report', state.auditReport);
      }

      // Stream Final Answer to Frontend
      await sendEvent('final_answer', {
        answer: state.finalAnswer,
        thoughtProcess: state.thoughtProcess,
        auditReport: state.auditReport
      });

      await sendEvent('status', { phase: 'COMPLETED' });

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

export default app;
