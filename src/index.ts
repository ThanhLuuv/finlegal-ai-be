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
import { DocumentPipeline } from './document/documentPipeline';
import { VectorRepository } from './storage/vectorRepository';
import { D1DocumentRepository } from './storage/d1DocumentRepository';
import { AnswerAgent } from './agents/answerAgent';
import { LangfuseLogger } from './utils/langfuse';
import { RetrievalScope } from './rag/types';


// Bindings Environment Interface for Workers
export interface Bindings {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  R2: R2Bucket;
  AI: Ai;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_SECRET_KEY?: string;
}


const app = new Hono<{ Bindings: Bindings }>();

// 1. Enable Global CORS for Next.js Cloudflare Pages Frontend (Must be FIRST for OPTIONS preflight)
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token', 'x-tenant-id', 'x-user-id', 'x-admin-key', 'X-Tenant-Id', 'X-User-Id', 'X-Admin-Key', '*'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
  maxAge: 86400,
}));

// 2. Cloudflare Anti-Bot & Threat Protection Middleware (with Turnstile Support)
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

  // Validate Cloudflare Turnstile Token from Encrypted Worker Environment Variable
  const secretKey = c.env.TURNSTILE_SECRET_KEY;
  if (turnstileToken && secretKey) {
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
    const adminKey = c.req.header('x-admin-key');
    const expectedKey = c.env.ADMIN_SECRET_KEY || 'admin_secret_default';
    if (!adminKey || adminKey !== expectedKey) {
      return c.json({ error: 'UNAUTHORIZED: Quyền truy cập quản trị bị từ chối.' }, 401);
    }

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

    for (const q of seedQueries) {
      await c.env.DB.prepare(q).run();
    }

    return c.json({ success: true, message: 'Thêm dữ liệu mẫu doanh nghiệp vào D1 Database thành công.' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Lỗi khởi tạo dữ liệu mẫu: ${errorMsg}` }, 500);
  }
});

// 3. Document Records List Endpoint (Flow C §21)
app.get('/api/documents', async (c) => {
  try {
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const documents = await d1Repo.listActiveDocuments();
    return c.json({ documents });
  } catch (err) {
    return c.json({ documents: [] });
  }
});

// 3.1. Single Document Record Fetch
app.get('/api/documents/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);
    if (!doc) return c.json({ error: 'Không tìm thấy tài liệu' }, 404);
    return c.json({ document: doc });
  } catch (err) {
    return c.json({ error: 'Lỗi truy vấn tài liệu' }, 500);
  }
});

// 3.2. Direct Document File View / Preview Endpoint (Streams file from R2)
app.get('/api/documents/:docId/view', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);

    if (!doc || !doc.r2_key) {
      return c.json({ error: 'Không tìm thấy file tài liệu trên hệ thống lưu trữ R2.' }, 404);
    }

    const r2Object = await c.env.R2.get(doc.r2_key);
    if (!r2Object) {
      return c.json({ error: 'File tài liệu không tồn tại trên R2 Storage.' }, 404);
    }

    const ext = (doc.file_name || '').split('.').pop()?.toLowerCase() || '';
    let contentType = 'application/octet-stream';
    if (ext === 'pdf') contentType = 'application/pdf';
    else if (ext === 'txt') contentType = 'text/plain; charset=utf-8';
    else if (ext === 'csv') contentType = 'text/csv; charset=utf-8';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.file_name)}"`);
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(r2Object.body, {
      status: 200,
      headers
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể xem tài liệu: ${errorMsg}` }, 500);
  }
});

// 3.5. Orchestrated Idempotent Delete Document Endpoint (Flow C §20 - DELETING status -> Vectors -> R2 -> D1)
app.delete('/api/documents/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const vectorRepo = new VectorRepository(c.env.VECTORIZE, c.env.AI);

    // 1. Mark status = DELETING to prevent concurrent retrieval
    await d1Repo.updateStatus(docId, 'DELETING', { errorMessage: 'Document deletion in progress' });

    // 2. Fetch vector IDs from D1 + generate fallback chunk IDs up to 300 chunks
    const d1VectorIds = await d1Repo.getChunkVectorIds(docId);
    const generatedChunkIds = Array.from({ length: 300 }, (_, i) => `${docId}_chunk_${i}`);
    const allIdsToDelete = Array.from(new Set([...d1VectorIds, ...generatedChunkIds]));

    try {
      await vectorRepo.deleteByIds(allIdsToDelete);
    } catch (vecErr) {
      console.warn('Vectorize deletion warning (retrying allowed):', vecErr);
    }

    // 3. Query document record from D1 to delete R2 storage file object (Idempotent)
    const doc = await d1Repo.getDocumentRecord(docId);
    if (doc && doc.r2_key) {
      try {
        await c.env.R2.delete(doc.r2_key);
      } catch (r2Err) {
        console.warn('R2 file deletion warning (retrying allowed):', r2Err);
      }
    }

    // 4. Delete metadata from D1 Database (document_records, document_sections, document_chunks)
    await d1Repo.deleteDocumentRecord(docId);

    return c.json({ success: true, message: 'Đã xóa triệt để tài liệu khỏi Vectorize, R2 và D1 thành công.' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể xóa tài liệu: ${errorMsg}` }, 500);
  }
});

// 3.6. Protected Internal AI Tracing Logs Listing Endpoint
app.get('/api/admin/logs', async (c) => {
  try {
    const adminKey = c.req.header('x-admin-key');
    const expectedKey = c.env.ADMIN_SECRET_KEY || 'admin_secret_default';
    if (!adminKey || adminKey !== expectedKey) {
      return c.json({ error: 'UNAUTHORIZED: Quyền truy cập quản trị bị từ chối.' }, 401);
    }

    const { results } = await c.env.DB.prepare('SELECT id, session_id, trace_id, user_prompt, intent, risk_level, created_at FROM chat_logs ORDER BY created_at DESC LIMIT 50').all();
    return c.json({ logs: results || [] });
  } catch (err) {
    return c.json({ logs: [] });
  }
});


// 4. Document Upload, Validation & Pipeline Processing Endpoint (Flow A & Flow C)
app.post('/api/documents', async (c) => {
  try {
    let formData: any;
    try {
      formData = await c.req.formData();
    } catch {
      formData = await c.req.parseBody();
    }

    const file = formData.get ? formData.get('file') : formData['file'];
    let fileName = 'document.pdf';
    let arrayBuffer: ArrayBuffer | null = null;
    const llm = new LLMProviderService(c.env.AI, c.env.OPENAI_API_KEY);

    if (file && typeof file !== 'string' && 'arrayBuffer' in file) {
      fileName = file.name || 'contract_document.pdf';
      arrayBuffer = (await file.arrayBuffer()) as ArrayBuffer;
    } else if (typeof formData['text'] === 'string' || (formData.get && typeof formData.get('text') === 'string')) {
      const textContent = typeof formData['text'] === 'string' ? formData['text'] : formData.get('text');
      fileName = (formData['fileName'] as string) || (formData.get && formData.get('fileName')) || 'text_contract.txt';
      const enc = new TextEncoder().encode(textContent);
      const buf = new ArrayBuffer(enc.byteLength);
      new Uint8Array(buf).set(enc);
      arrayBuffer = buf;
    }

    // Step 2 Validation: Check supported extension & empty buffer (Flow A §2)
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const allowedExts = ['pdf', 'txt', 'csv'];
    if (!allowedExts.includes(ext)) {
      return c.json({ error: `INVALID_FILE: Định dạng file .${ext} chưa hỗ trợ bóc tách trực tiếp (Hiện hỗ trợ .pdf, .txt, .csv).` }, 400);
    }


    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return c.json({ error: 'INVALID_FILE: Tập tin tải lên bị rỗng hoặc không đúng định dạng.' }, 400);
    }

    // Size limit check (max 25MB)
    if (arrayBuffer.byteLength > 25 * 1024 * 1024) {
      return c.json({ error: 'INVALID_FILE: Dung lượng file vượt quá giới hạn 25MB.' }, 400);
    }

    const docId = `doc_${Date.now()}`;
    const pipeline = new DocumentPipeline(
      llm,
      c.env.DB,
      c.env.VECTORIZE,
      c.env.R2,
      c.env.AI
    );

    const result = await pipeline.processDocument(docId, fileName, arrayBuffer);

    return c.json({
      success: true,
      docId: result.docId,
      fileName: result.fileName,
      totalChunks: result.totalChunks,
      warnings: result.warnings,
      message: result.message
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Lỗi xử lý tài liệu: ${errorMsg}` }, 500);
  }
});

// Legacy fallback endpoint mapping
app.post('/api/upload', async (c) => {
  return app.fetch(new Request(`${new URL(c.req.url).origin}/api/documents`, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: c.req.raw.body
  }), c.env, c.executionCtx);
});

// 4.1. Document Version Update Endpoint (Flow C §21)
app.post('/api/documents/:docId/version', async (c) => {
  try {
    const parentDocId = c.req.param('docId');
    let formData: any;
    try {
      formData = await c.req.formData();
    } catch {
      formData = await c.req.parseBody();
    }

    const file = formData.get ? formData.get('file') : formData['file'];
    if (!file || typeof file === 'string' || !('arrayBuffer' in file)) {
      return c.json({ error: 'Vui lòng chọn file phiên bản mới.' }, 400);
    }

    const fileName = file.name || 'document_v2.pdf';
    const arrayBuffer = (await file.arrayBuffer()) as ArrayBuffer;

    const d1Repo = new D1DocumentRepository(c.env.DB);
    const parentDoc = await d1Repo.getDocumentRecord(parentDocId);
    let nextVersion = 'v2';
    if (parentDoc && parentDoc.version) {
      const match = parentDoc.version.match(/\d+/);
      const currentVerNum = match ? parseInt(match[0], 10) : 1;
      nextVersion = `v${currentVerNum + 1}`;
    }

    const newDocId = `doc_${Date.now()}`;
    const llm = new LLMProviderService(c.env.AI, c.env.OPENAI_API_KEY);
    const pipeline = new DocumentPipeline(
      llm,
      c.env.DB,
      c.env.VECTORIZE,
      c.env.R2,
      c.env.AI
    );

    const result = await pipeline.processDocument(newDocId, fileName, arrayBuffer, {
      version: nextVersion,
      parentDocId
    });

    return c.json({
      success: true,
      docId: result.docId,
      version: nextVersion,
      fileName: result.fileName,
      totalChunks: result.totalChunks,
      message: `Đã cập nhật lên phiên bản ${nextVersion} thành công.`
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Lỗi cập nhật phiên bản: ${errorMsg}` }, 500);
  }
});


// 4. Real-time Multi-Agent SSE Chat & Audit Streaming Handler
app.post('/api/chat/stream', async (c) => {
  const startTime = Date.now();
  const body = await c.req.json<{
    prompt: string;
    docId?: string;
    sessionId?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>();
  const prompt = body.prompt;
  const docId = body.docId;
  const sessionId = body.sessionId || crypto.randomUUID();
  const traceId = crypto.randomUUID();
  const history = body.history || [];

  const tenantId = c.req.header('x-tenant-id') || 'tenant_default';
  const userId = c.req.header('x-user-id') || 'user_default';
  const scope: RetrievalScope = {
    tenantId,
    userId,
    documentIds: docId ? [docId] : undefined
  };

  if (!prompt || prompt.trim().length === 0) {
    return c.json({ error: 'Prompt is required' }, 400);
  }

  // IP Rate Limiting Check (CV Protection: 5 Requests / 10 Minutes per IP)
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const now = Date.now();
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes window
  const MAX_REQUESTS = 5; // 5 requests max limit

  try {
    const record = await c.env.DB.prepare('SELECT request_count, reset_at FROM ip_rate_limits WHERE ip = ?').bind(clientIp).first<{ request_count: number; reset_at: number }>();
    if (record) {
      if (now > record.reset_at) {
        // Window expired -> Reset count
        await c.env.DB.prepare('UPDATE ip_rate_limits SET request_count = 1, reset_at = ? WHERE ip = ?').bind(now + WINDOW_MS, clientIp).run();
      } else if (record.request_count >= MAX_REQUESTS) {
        const minutesLeft = Math.ceil((record.reset_at - now) / 60000);
        return c.json({
          error: `Hệ thống bảo vệ tự động: Địa chỉ IP của bạn đã dùng hết 5 lượt hỏi trong 10 phút để tránh rủi ro quá tải. Vui lòng quay lại sau ${minutesLeft} phút!`
        }, 429);
      } else {
        // Increment count
        await c.env.DB.prepare('UPDATE ip_rate_limits SET request_count = request_count + 1 WHERE ip = ?').bind(clientIp).run();
      }
    } else {
      // First request from this IP
      await c.env.DB.prepare('INSERT INTO ip_rate_limits (ip, request_count, reset_at) VALUES (?, 1, ?)').bind(clientIp, now + WINDOW_MS).run();
    }
  } catch (rateErr) {
    console.warn('Rate limiting check warning:', rateErr);
  }

  // Initialize Services & Repositories
  const llm = new LLMProviderService(c.env.AI, c.env.OPENAI_API_KEY);
  const d1Service = new D1DatabaseService(c.env.DB);
  const d1Repo = new D1DocumentRepository(c.env.DB);
  const vectorRepo = new VectorRepository(c.env.VECTORIZE, c.env.AI);
  const langfuse = new LangfuseLogger(c.env.LANGFUSE_PUBLIC_KEY, c.env.LANGFUSE_SECRET_KEY, c.env.LANGFUSE_HOST);

  // Initialize Multi-Agent instances
  const supervisor = new SupervisorAgent(llm);
  const ragAgent = new AdvancedRAGAgent(llm, vectorRepo, d1Repo);
  const sqlAgent = new SQLToolAgent(llm, d1Service);
  const auditor = new RiskAuditorAgent(llm);
  const answerAgent = new AnswerAgent(llm);



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
    (state as any).scope = scope;
    (state as any).history = history;

    await sendEvent('status', { phase: 'STARTED', traceId, sessionId });

    // Helper to stream sanitized JSON SSE thought events (P1.25 Privacy Redaction)
    const sendSanitizedThought = async (step?: any) => {
      if (!step) return;
      const sanitizedStep = {
        agent: step.agent,
        status: step.status,
        thought: step.thought,
        timestamp: step.timestamp
      };
      await sendEvent('thought', sanitizedStep);
    };

    try {
      // Step 1: Supervisor Intent Routing (Bypass LLM supervisor if docId is explicitly selected)
      if (docId) {
        state.intent = 'RAG_ONLY';
        state.thoughtProcess.push({
          agent: 'SUPERVISOR',
          status: 'DONE',
          thought: `Đã chọn tập tin văn bản (${docId}). Tự động chuyển hướng tới RAG Retrieval Engine.`,
          timestamp: Date.now()
        });
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      } else {
        state = await supervisor.execute(state);
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      const intent = state.intent || 'RAG_ONLY';

      // Step 2 & 3: Agent Execution based on Intent
      if (intent === 'RAG_ONLY' || intent === 'HYBRID_AUDIT') {
        state = await ragAgent.execute(state);
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      }

      if (intent === 'SQL_ONLY' || intent === 'HYBRID_AUDIT') {
        state = await sqlAgent.execute(state);
        await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
      }


      // Step 4: Auditor & Zero-Hallucination Answer Synthesizer
      if (intent === 'HYBRID_AUDIT' || intent === 'RAG_ONLY' || intent === 'SQL_ONLY') {
        if (intent === 'HYBRID_AUDIT') {
          state = await auditor.execute(state);
          await sendSanitizedThought(state.thoughtProcess[state.thoughtProcess.length - 1]);
        }


        const ragResult = (state as any).ragResult;
        state.finalAnswer = await answerAgent.generateAnswer(state, ragResult);
      } else {
        // General Chat
        const generalReply = await llm.generateText([
          {
            role: 'system',
            content: 'Bạn là Trợ lý AI FinLegal AI chuyên phân tích Hợp đồng và Đối soát Số liệu Bán hàng Doanh nghiệp. Bạn BẮT BUỘC phải trả lời bằng Tiếng Việt 100%, lịch sự, chuyên nghiệp và ngắn gọn.'
          },
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

      // Save trace log into D1 Database (Internal Tracing System)
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

export default app;
