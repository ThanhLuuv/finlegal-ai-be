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
import { extractTextFromPDFBuffer } from './utils/pdfExtractor';
import { AIDocumentProcessorService } from './services/aiDocProcessor';
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

// 2. Enable CORS for Next.js Cloudflare Pages Frontend
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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

// 3.5. Delete Document Endpoint (Cleans D1 Database, R2 Storage & Vectorize Index)
app.delete('/api/documents/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');

    // 1. Delete vector embeddings from Cloudflare Vectorize Index
    try {
      const vectorIds = Array.from({ length: 35 }, (_, i) => `${docId}_chunk_${i}`);
      await c.env.VECTORIZE.deleteByIds(vectorIds);
    } catch (vecErr) {
      console.warn('Vectorize deletion warning:', vecErr);
    }

    // 2. Query document record from D1 to retrieve R2 storage key and delete file object
    const doc = await c.env.DB.prepare('SELECT r2_key FROM document_records WHERE doc_id = ?').bind(docId).first<{ r2_key?: string }>();
    if (doc && doc.r2_key) {
      try {
        await c.env.R2.delete(doc.r2_key);
      } catch (r2Err) {
        console.warn('R2 file deletion warning:', r2Err);
      }
    }

    // 3. Delete record from D1 Database
    await c.env.DB.prepare('DELETE FROM document_records WHERE doc_id = ?').bind(docId).run();

    return c.json({ success: true, message: 'Đã xóa triệt để tài liệu, kho Vector và cơ sở dữ liệu D1 thành công.' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể xóa tài liệu: ${errorMsg}` }, 500);
  }
});

// 3.6. Internal AI Tracing Logs Listing Endpoint
app.get('/api/admin/logs', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT id, session_id, trace_id, user_prompt, intent, thought_process, final_response, risk_level, created_at FROM chat_logs ORDER BY created_at DESC LIMIT 50').all();
    return c.json({ logs: results || [] });
  } catch (err) {
    return c.json({ logs: [] });
  }
});

// 4. PDF Document Upload, Chunking & Vector Ingestion Endpoint
app.post('/api/upload', async (c) => {
  try {
    let formData: any;
    try {
      formData = await c.req.formData();
    } catch {
      formData = await c.req.parseBody();
    }

    const file = formData.get ? formData.get('file') : formData['file'];
    let textContent = '';
    let fileName = 'document.pdf';

    if (file && typeof file !== 'string' && 'arrayBuffer' in file) {
      fileName = file.name || 'contract_document.pdf';
      const arrayBuffer = await file.arrayBuffer();
      // Store raw file in R2 Storage
      const docId = `doc_${Date.now()}`;
      await c.env.R2.put(`documents/${docId}/${fileName}`, arrayBuffer);

      // Extract clean readable text from PDF binary buffer using custom worker parser
      textContent = await extractTextFromPDFBuffer(arrayBuffer);
    } else if (typeof formData['text'] === 'string' || (formData.get && typeof formData.get('text') === 'string')) {
      textContent = typeof formData['text'] === 'string' ? formData['text'] : formData.get('text');
      fileName = (formData['fileName'] as string) || (formData.get && formData.get('fileName')) || 'text_contract.txt';
    }

    if (!textContent || textContent.trim().length === 0) {
      return c.json({ error: 'Không thể đọc hoặc trích xuất nội dung văn bản từ tập tin đã chọn.' }, 400);
    }


    // AI Document Ingestion Pre-Processor: Repair, clean & structure raw text into Markdown
    const llm = new LLMProviderService(c.env.AI, c.env.GEMINI_API_KEY);
    const aiProcessor = new AIDocumentProcessorService(llm);
    const structuredMarkdown = await aiProcessor.cleanAndStructureDocument(textContent, fileName);

    const docId = `doc_${Date.now()}`;
    const chunker = new TablePreservingChunker(1000, 200);
    const chunks = chunker.chunkDocument(structuredMarkdown);

    // Index into Cloudflare Vectorize
    const vectorizeService = new VectorizeService(c.env.VECTORIZE, c.env.AI);
    await vectorizeService.insertChunks(docId, fileName, chunks);

    const r2Key = `documents/${docId}/${fileName}`;

    // Save record to Cloudflare D1 Database
    await c.env.DB.prepare(
      `INSERT INTO document_records (doc_id, file_name, r2_key, total_pages, total_chunks, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(docId, fileName, r2Key, 1, chunks.length, new Date().toISOString()).run();

    return c.json({
      success: true,
      docId,
      fileName,
      totalChunks: chunks.length,
      message: 'Hợp đồng đã được phân tích và lưu trữ thành công vào kho Vector.'
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Lỗi tải tập tin: ${errorMsg}` }, 500);
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
          error: `⚠️ Hệ thống bảo vệ tự động: Địa chỉ IP của bạn đã dùng hết 5 lượt hỏi trong 10 phút để tránh rủi ro spam. Vui lòng quay lại sau ${minutesLeft} phút!` 
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
