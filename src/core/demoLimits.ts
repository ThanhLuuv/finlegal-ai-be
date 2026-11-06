export const DEMO_LIMITS = {
  maxFileBytes: 3 * 1024 * 1024,
  maxDocuments: 3,
  maxDocumentChars: 40000,
  maxChunks: 40,
  maxPromptChars: 2000,
  maxHistoryMessages: 4,
  maxHistoryChars: 4000,
  maxChatBodyBytes: 32 * 1024,
  maxInputChars: 24000,
  maxOutputTokens: 1024,
  maxProviderAttempts: 6,
  chatPer10Minutes: 5,
  chatPerDay: 20,
  globalChatPerDay: 100,
  uploadsPer10Minutes: 3,
  uploadsPerDay: 5,
  globalUploadsPerDay: 20,
} as const;

export class DemoLimitError extends Error {
  readonly code = 'DEMO_LIMIT_EXCEEDED';
  constructor(message: string, readonly status: 400 | 413 | 422 | 429 | 503 = 422, readonly retryAfter?: number) {
    super(`Đây là bản demo FinLegal. ${message}`);
  }
}

export function validateDemoFile(fileName: string, bytes: number): void {
  if (!/\.(pdf|docx|txt|csv|md)$/i.test(fileName)) throw new DemoLimitError('Chỉ hỗ trợ PDF có văn bản, DOCX, TXT, CSV và Markdown.', 400);
  if (bytes <= 0) throw new DemoLimitError('Tập tin không có nội dung.', 400);
  if (bytes > DEMO_LIMITS.maxFileBytes) throw new DemoLimitError('Mỗi file tối đa 3 MB. Vui lòng chọn file nhỏ hơn hoặc tách tài liệu.', 413);
  if (fileName.length > 200) throw new DemoLimitError('Tên file tối đa 200 ký tự. Vui lòng đổi tên file.', 400);
}

export function validateDemoText(text: string): void {
  if (text.length > DEMO_LIMITS.maxDocumentChars) throw new DemoLimitError('Tài liệu vượt ngưỡng 40.000 ký tự. Vui lòng tách thành tài liệu ngắn hơn; hệ thống chưa tạo embedding cho file này.');
}

// Count the actual bytes even if Content-Length is absent or understates the body.
export async function readLimitedRequest(request: Request, limit: number): Promise<Request> {
  const tooLarge = () => new DemoLimitError('Dữ liệu gửi lên vượt ngưỡng cho phép. Hãy gửi file nhỏ hơn hoặc rút gọn yêu cầu.', 413);
  if (Number(request.headers.get('content-length')) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return request;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, { method: request.method, headers, body: bytes });
}

export function validateDemoChat(body: { prompt: string; history?: unknown }): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (body.prompt.length > DEMO_LIMITS.maxPromptChars) throw new DemoLimitError('Mỗi câu hỏi tối đa 2.000 ký tự. Vui lòng rút gọn hoặc chia thành các câu hỏi nhỏ.', 413);
  if (body.history === undefined) return [];
  if (!Array.isArray(body.history) || body.history.length > DEMO_LIMITS.maxHistoryMessages) throw new DemoLimitError('Mỗi yêu cầu chỉ được gửi tối đa 4 tin nhắn lịch sử. Hãy bắt đầu cuộc trò chuyện mới.', 400);
  let chars = 0;
  for (const message of body.history) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new DemoLimitError('Lịch sử hội thoại không hợp lệ.', 400);
    chars += message.content.length;
  }
  if (chars > DEMO_LIMITS.maxHistoryChars) throw new DemoLimitError('Lịch sử hội thoại vượt 4.000 ký tự. Hãy bắt đầu một câu hỏi mới với ít lịch sử hơn.', 413);
  return body.history;
}

export async function reserveDemoUsage(db: D1Database, ip: string, kind: 'chat' | 'upload', now = Date.now()): Promise<void> {
  const minuteWindow = 10 * 60 * 1000;
  const dayWindow = 24 * 60 * 60 * 1000;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const identity = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const caps = kind === 'chat'
    ? [[`ip:${identity}:short`, minuteWindow, DEMO_LIMITS.chatPer10Minutes, 'Bạn đã dùng hết 5 lượt hỏi trong 10 phút.'], [`ip:${identity}:day`, dayWindow, DEMO_LIMITS.chatPerDay, 'Bạn đã dùng hết 20 lượt hỏi trong ngày.'], ['global:day', dayWindow, DEMO_LIMITS.globalChatPerDay, 'Hệ thống đã hết hạn mức hỏi đáp demo hôm nay.'] ] as const
    : [[`ip:${identity}:short`, minuteWindow, DEMO_LIMITS.uploadsPer10Minutes, 'Bạn đã dùng hết 3 lượt xử lý tài liệu trong 10 phút.'], [`ip:${identity}:day`, dayWindow, DEMO_LIMITS.uploadsPerDay, 'Bạn đã dùng hết 5 lượt xử lý tài liệu trong ngày.'], ['global:day', dayWindow, DEMO_LIMITS.globalUploadsPerDay, 'Hệ thống đã hết hạn mức xử lý tài liệu demo hôm nay.'] ] as const;
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS demo_usage (key TEXT PRIMARY KEY, used INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
    await db.prepare('DELETE FROM demo_usage WHERE expires_at <= ?').bind(now).run();
    for (const [scope, window, maximum, message] of caps) {
      const start = Math.floor(now / window) * window;
      const end = start + window;
      // One atomic statement: simultaneous requests cannot all pass a read-then-write check.
      const reserved = await db.prepare(`INSERT INTO demo_usage (key, used, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET used = used + 1 WHERE used < ? RETURNING used`)
        .bind(`${kind}:${scope}:${start}`, end, maximum).first<{ used: number }>();
      if (!reserved) throw new DemoLimitError(`${message} Vui lòng chờ hạn mức được làm mới rồi thử lại.`, 429, Math.max(1, Math.ceil((end - now) / 1000)));
    }
  } catch (error) {
    if (error instanceof DemoLimitError) throw error;
    console.error('Demo quota unavailable');
    // Fail closed: a database outage must never enable unlimited paid model calls.
    throw new DemoLimitError('Chưa kiểm tra được hạn mức sử dụng. Vui lòng thử lại sau ít phút.', 503, 60);
  }
}
