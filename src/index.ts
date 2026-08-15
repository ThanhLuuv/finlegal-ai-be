// FinLegal AI Engine - Hono.js Engine on Cloudflare Workers

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { adminRoutes } from './routes/adminRoutes';
import { documentRoutes } from './routes/documentRoutes';
import { chatRoutes } from './routes/chatRoutes';

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

// 1. Global CORS Middleware for Frontend Access
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token', 'x-tenant-id', 'x-user-id', 'x-admin-key', 'X-Tenant-Id', 'X-User-Id', 'X-Admin-Key', '*'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
  maxAge: 86400,
}));

// 2. Cloudflare Anti-Bot & Threat Protection Middleware
app.use('*', async (c, next) => {
  const userAgent = c.req.header('user-agent') || '';
  const clientIP = c.req.header('cf-connecting-ip') || 'unknown';
  const turnstileToken = c.req.header('X-Turnstile-Token');

  // Block known scanner bot signatures
  const suspiciousBotSignatures = [
    'sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab',
    'eval-at-log', 'dirbuster', 'gobuster', 'python-urllib'
  ];

  const isBlockedBot = suspiciousBotSignatures.some(sig => userAgent.toLowerCase().includes(sig));
  if (isBlockedBot) {
    return c.json({ error: 'Access denied by Cloudflare Bot Defense.' }, 403);
  }

  // Validate Cloudflare Turnstile Token if present
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
      // Allow fallback if verification endpoint is unreachable
    }
  }

  await next();

  // Enterprise Security Headers
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Protection-Provider', 'Cloudflare Serverless Edge Bot Defense & Turnstile');
});

// 3. Health Check Endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'FinLegal AI Workers Engine',
    timestamp: new Date().toISOString()
  });
});

// 4. Mount Sub-Routers
app.route('/api/admin', adminRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/chat', chatRoutes);

// 5. Legacy Fallback Upload Endpoint Mapping
app.post('/api/upload', async (c) => {
  return app.fetch(new Request(`${new URL(c.req.url).origin}/api/documents`, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: c.req.raw.body
  }), c.env, c.executionCtx);
});

export default app;
