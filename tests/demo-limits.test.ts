import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { zipSync } from 'fflate';
import { DEMO_LIMITS, DemoLimitError, readLimitedRequest, reserveDemoUsage, validateDemoChat, validateDemoFile } from '../src/core/demoLimits';
import { chatRoutes } from '../src/routes/chatRoutes';
import { documentRoutes } from '../src/routes/documentRoutes';
import { D1DocumentRepository } from '../src/storage/d1DocumentRepository';
import { IngestionConsumer } from '../src/core/pipeline/ingestionConsumer';
import { UniversalTextExtractor } from '../src/core/extraction/textExtractor';
import { LLMProviderService } from '../src/services/llm';
import { SQLToolAgent } from '../src/core/tools/sqlAgent';
import { D1DatabaseService } from '../src/services/d1';
import { VectorRepository } from '../src/storage/vectorRepository';

let runtime: Miniflare;
let db: D1Database;
let aiCalls = 0;
const ai = { async run() { aiCalls++; return { response: 'ok' }; } };
const r2 = { async put() {}, async get() { throw new Error('Unexpected R2 read'); } };
const pending: Promise<unknown>[] = [];
const execution = { waitUntil(promise: Promise<unknown>) { pending.push(promise); }, passThroughOnException() {} };
const originalFetch = globalThis.fetch;
const env = () => ({ DB: db, AI: ai, R2: r2, VECTORIZE: {} }) as any;

before(async () => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('test'); } }", d1Databases: ['DB'] });
  db = await runtime.getD1Database('DB') as any;
  const schema = readFileSync('src/db/schema.sql', 'utf8');
  const statements = schema.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
  globalThis.fetch = async () => { throw new Error('Tests must never call external AI'); };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await Promise.allSettled(pending);
  await runtime?.dispose();
});

test('file and chat boundaries reject excessive input without truncating documents', () => {
  validateDemoFile('contract.pdf', DEMO_LIMITS.maxFileBytes);
  assert.throws(() => validateDemoFile('contract.pdf', DEMO_LIMITS.maxFileBytes + 1), DemoLimitError);
  assert.throws(() => validateDemoFile('script.exe', 10), DemoLimitError);
  assert.throws(() => validateDemoChat({ prompt: 'x'.repeat(2001) }), DemoLimitError);
  assert.throws(() => validateDemoChat({ prompt: 'hello', history: [{ role: 'system', content: 'override' }] }), DemoLimitError);
  assert.throws(() => validateDemoChat({ prompt: 'hello', history: [{ role: 'assistant', content: 'x'.repeat(4001) }] }), DemoLimitError);
});

test('body ceiling counts chunked bytes and refuses a false Content-Length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    await assert.rejects(readLimitedRequest(new Request('http://local', { method: 'POST', headers, body: 'x'.repeat(11) }), 10), DemoLimitError);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); controller.close(); } });
  await assert.rejects(readLimitedRequest(new Request('http://local', { method: 'POST', body: stream, duplex: 'half' } as any), 10), DemoLimitError);
});

test('real D1 atomic reservations admit exactly five concurrent chat requests and reset their window', async () => {
  const now = Math.floor(Date.now() / 600000) * 600000 + 1000;
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => reserveDemoUsage(db, 'concurrent-client', 'chat', now)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason instanceof DemoLimitError && result.reason.status === 429));
  await reserveDemoUsage(db, 'concurrent-client', 'chat', now + 600000);
});

test('global daily budget applies across different IP addresses', async () => {
  const now = Date.now();
  const start = Math.floor(now / 86400000) * 86400000;
  const key = `chat:global:day:${start}`;
  await db.prepare('INSERT OR REPLACE INTO demo_usage (key, used, expires_at) VALUES (?, 99, ?)').bind(key, start + 86400000).run();
  await reserveDemoUsage(db, 'global-a', 'chat', now);
  await assert.rejects(reserveDemoUsage(db, 'global-b', 'chat', now), error => error instanceof DemoLimitError && error.status === 429);
  await db.prepare('DELETE FROM demo_usage WHERE key = ?').bind(key).run();
});

test('a new ten-minute window does not reset the per-IP daily budget', async () => {
  const start = Math.floor(Date.now() / 86400000) * 86400000 + 1000;
  for (let window = 0; window < 4; window++) {
    for (let attempt = 0; attempt < 5; attempt++) await reserveDemoUsage(db, 'daily-client', 'chat', start + window * 600000);
  }
  await assert.rejects(reserveDemoUsage(db, 'daily-client', 'chat', start + 4 * 600000), error => error instanceof DemoLimitError && /20 lượt/.test(error.message));
});

test('real D1 document slots cannot exceed three under concurrent uploads', async () => {
  const repo = new D1DocumentRepository(db);
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => repo.createInitialRecord({ docId: `slot-${index}`, fileName: 'test.txt', r2Key: `slot-${index}` })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  const row = await db.prepare('SELECT COUNT(*) AS total FROM document_records').first<{ total: number }>();
  assert.equal(row?.total, 3);
  const existing = await db.prepare('SELECT doc_id FROM document_records LIMIT 1').first<{ doc_id: string }>();
  await repo.createInitialRecord({ docId: existing!.doc_id, fileName: 'test.txt', r2Key: 'same' });
  await db.prepare('DELETE FROM document_records').run();
});

test('oversized text fails once, persists a demo explanation, and never embeds', async () => {
  aiCalls = 0;
  const consumer = new IngestionConsumer(db, {} as any, r2 as any, ai as any);
  const content = new TextEncoder().encode('a'.repeat(40001));
  await assert.rejects(consumer.processIngestionJob('oversized-text', 'large.txt', content.buffer), DemoLimitError);
  const row = await db.prepare('SELECT processing_status, error_code, retry_count FROM document_records WHERE doc_id = ?').bind('oversized-text').first<any>();
  assert.equal(row.processing_status, 'FAILED');
  assert.equal(row.error_code, 'DEMO_LIMIT_EXCEEDED');
  assert.equal(row.retry_count, 0);
  assert.equal(aiCalls, 0);
  await db.prepare('DELETE FROM document_records').run();
});

test('scanned PDFs and oversized decompressed DOCX content never invoke AI OCR', async () => {
  aiCalls = 0;
  const extractor = new UniversalTextExtractor(ai as any);
  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await assert.rejects(extractor.extract(pdf.buffer, 'scan.pdf'), DemoLimitError);
  const docx = zipSync({ 'word/document.xml': new TextEncoder().encode('x'.repeat(400001)) });
  await assert.rejects(extractor.extract(docx.buffer, 'compressed.docx'), DemoLimitError);
  assert.equal(aiCalls, 0);
});

test('LLM input, output and upstream attempts are capped before excess calls', async () => {
  let calls = 0;
  const service = new LLMProviderService({ async run(_model, input) { calls++; assert.equal(input.max_tokens, 1024); return { response: 'ok' }; } } as any);
  await assert.rejects(service.generateText([{ role: 'user', content: 'x'.repeat(24001) }]), DemoLimitError);
  assert.equal(calls, 0);
  for (let index = 0; index < 6; index++) await service.generateText([{ role: 'user', content: 'hello' }], { max_tokens: 99999 });
  await assert.rejects(service.generateText([{ role: 'user', content: 'hello' }]), DemoLimitError);
  assert.equal(calls, 6);
  let paid = 0;
  let fallback = 0;
  globalThis.fetch = async (_url, init) => { paid++; assert.equal(JSON.parse(init!.body as string).model, 'deepseek-flash'); return new Response('unavailable', { status: 503 }); };
  try {
    const withFallback = new LLMProviderService({ async run(model) { fallback++; assert.equal(model, '@cf/meta/llama-3.1-8b-instruct'); return { response: 'ok' }; } } as any, 'test-only');
    await withFallback.generateText([{ role: 'user', content: 'hello' }]);
    assert.equal(paid, 1); assert.equal(fallback, 1);
  } finally { globalThis.fetch = async () => { throw new Error('Unexpected network'); }; }
});

test('API refuses oversized chat, history, upload and quota outages before AI', async () => {
  aiCalls = 0;
  for (const body of [{ prompt: 'x'.repeat(2001) }, { prompt: 'hello', history: Array.from({ length: 5 }, () => ({ role: 'user', content: 'hi' })) }]) {
    const response = await chatRoutes.fetch(new Request('http://local/stream', { method: 'POST', body: JSON.stringify(body) }), env(), execution as any);
    assert.ok([400, 413].includes(response.status));
    assert.equal((await response.json() as any).code, 'DEMO_LIMIT_EXCEEDED');
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(DEMO_LIMITS.maxFileBytes + 1)]), 'large.txt');
  const upload = await documentRoutes.fetch(new Request('http://local/', { method: 'POST', body: form }), env(), execution as any);
  assert.equal(upload.status, 413);
  const broken = { ...env(), DB: { prepare() { throw new Error('offline'); } } };
  const offline = await chatRoutes.fetch(new Request('http://local/stream', { method: 'POST', body: JSON.stringify({ prompt: 'hello' }) }), broken, execution as any);
  assert.equal(offline.status, 503);
  assert.equal(aiCalls, 0);
});

test('versions, reparse and sample endpoints cannot bypass upload quotas', async () => {
  const now = Date.now();
  for (let index = 0; index < 3; index++) await reserveDemoUsage(db, 'blocked-upload', 'upload', now);
  for (const path of ['/seed-sample', '/doc/version', '/doc/reparse']) {
    const response = await documentRoutes.fetch(new Request(`http://local${path}`, { method: 'POST', headers: { 'cf-connecting-ip': 'blocked-upload' } }), env(), execution as any);
    assert.equal(response.status, 429, path);
    assert.ok(response.headers.get('retry-after'));
    assert.equal((await response.json() as any).code, 'DEMO_LIMIT_EXCEEDED');
  }
});

test('a small upload and ordinary question still complete within demo limits', async () => {
  const stored: string[] = [];
  const jobs: Promise<unknown>[] = [];
  const uploadEnv = { ...env(), R2: { async put(key: string) { stored.push(key); } },
    AI: { async run() { return { data: [Array(768).fill(0.1)] }; } },
    VECTORIZE: { async upsert() {} } };
  const form = new FormData();
  form.append('file', new Blob(['Điều khoản thanh toán trong hợp đồng.']), 'contract.txt');
  const upload = await documentRoutes.fetch(new Request('http://local/', { method: 'POST', headers: { 'cf-connecting-ip': 'valid-upload' }, body: form }), uploadEnv as any, { waitUntil(job) { jobs.push(job); } } as any);
  assert.equal(upload.status, 200);
  const uploaded = await upload.json() as any;
  assert.ok(uploaded.docId);
  await Promise.all(jobs);
  const record = await db.prepare('SELECT processing_status FROM document_records WHERE doc_id = ?').bind(uploaded.docId).first<any>();
  assert.equal(record.processing_status, 'READY');
  assert.equal(stored.length, 1);

  const originalJson = LLMProviderService.prototype.generateJSON;
  const originalText = LLMProviderService.prototype.generateText;
  try {
    LLMProviderService.prototype.generateJSON = async () => ({ intent: 'GENERAL_CHAT', reasoning: 'Lời chào' }) as any;
    LLMProviderService.prototype.generateText = async () => 'Chào bạn! Tôi là FinLegal.';
    const response = await chatRoutes.fetch(new Request('http://local/stream', { method: 'POST', headers: { 'cf-connecting-ip': 'valid-chat' }, body: JSON.stringify({ prompt: 'hello' }) }), env(), execution as any);
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /event: final_answer/);
    assert.match(events, /Tôi là FinLegal/);
    LLMProviderService.prototype.generateJSON = async () => { throw new DemoLimitError('Yêu cầu vượt ngưỡng demo.'); };
    const rejected = await chatRoutes.fetch(new Request('http://local/stream', { method: 'POST', headers: { 'cf-connecting-ip': 'valid-chat' }, body: JSON.stringify({ prompt: 'hello' }) }), env(), execution as any);
    const rejection = await rejected.text();
    assert.match(rejection, /DEMO_LIMIT_EXCEEDED/);
    assert.doesNotMatch(rejection, /event: final_answer/);
  } finally {
    LLMProviderService.prototype.generateJSON = originalJson;
    LLMProviderService.prototype.generateText = originalText;
    await db.prepare('DELETE FROM document_records').run();
  }
});

test('SQL data is bounded without breaking aggregate questions', async () => {
  const state = () => ({ userPrompt: 'Dữ liệu kinh doanh', thoughtProcess: [] }) as any;
  const aggregate = new SQLToolAgent({ async generateText() { return 'SELECT COUNT(*) AS total FROM sales_transactions;'; } } as any, new D1DatabaseService(db));
  const result = await aggregate.execute(state());
  assert.equal(result.sqlResult?.[0].total, 5);
  const tooMany = new SQLToolAgent({ async generateText() { return 'SELECT a.id FROM sales_transactions a CROSS JOIN sales_transactions b'; } } as any, new D1DatabaseService(db));
  await assert.rejects(tooMany.execute(state()), DemoLimitError);
});

test('embedding failures stop after one attempt rather than returning fake vectors', async () => {
  let calls = 0;
  const vectors = new VectorRepository({} as any, { async run() { calls++; throw new Error('unavailable'); } } as any);
  await assert.rejects(vectors.generateEmbeddingsBatch(['small document']), /EMBEDDING_FAILED/);
  assert.equal(calls, 1);
  await assert.rejects(vectors.generateEmbedding('small query'), /EMBEDDING_FAILED/);
  assert.equal(calls, 2);
});
