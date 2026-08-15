// Admin Routes - Database Seeding & Tracing Logs

import { Hono } from 'hono';
import { Bindings } from '../index';

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

// 1. Admin Seed Endpoint - Populates D1 with Enterprise Sales Data
adminRoutes.post('/seed', async (c) => {
  try {
    const adminKey = c.req.header('x-admin-key');
    const expectedKey = c.env.ADMIN_SECRET_KEY || 'admin_secret_default';
    if (!adminKey || adminKey !== expectedKey) {
      return c.json({ error: 'UNAUTHORIZED: Quyền truy cập quản trị bị từ chối.' }, 401);
    }

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

// 2. Protected Internal AI Tracing Logs Listing Endpoint
adminRoutes.get('/logs', async (c) => {
  try {
    const adminKey = c.req.header('x-admin-key');
    const expectedKey = c.env.ADMIN_SECRET_KEY || 'admin_secret_default';
    if (!adminKey || adminKey !== expectedKey) {
      return c.json({ error: 'UNAUTHORIZED: Quyền truy cập quản trị bị từ chối.' }, 401);
    }

    const { results } = await c.env.DB.prepare(
      'SELECT id, session_id, trace_id, user_prompt, intent, risk_level, created_at FROM chat_logs ORDER BY created_at DESC LIMIT 50'
    ).all();
    return c.json({ logs: results || [] });
  } catch {
    return c.json({ logs: [] });
  }
});
