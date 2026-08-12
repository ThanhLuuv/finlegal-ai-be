-- ====================================================================
-- FinLegal AI Database Schema (Cloudflare D1 Serverless SQLite)
-- Production Ready Schema for Enterprise Financial & Sales Audit
-- ====================================================================

-- 1. Sales & Revenue Transactions Table
CREATE TABLE IF NOT EXISTS sales_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    contract_ref TEXT NOT NULL,
    quarter TEXT NOT NULL,          -- Format: 'Q1-2024', 'Q2-2024', etc.
    revenue_usd REAL NOT NULL,      -- Actual revenue recorded in DB
    status TEXT NOT NULL,           -- 'COMPLETED', 'PENDING', 'CANCELLED'
    transaction_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Document Registry Metadata Table
CREATE TABLE IF NOT EXISTS document_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    total_pages INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    uploaded_by TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Audit & Chat Execution Telemetry Logs
CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    intent TEXT NOT NULL,           -- 'RAG_ONLY', 'SQL_ONLY', 'HYBRID_AUDIT', 'GENERAL_CHAT'
    thought_process TEXT NOT NULL,  -- JSON string of step-by-step reasoning
    final_response TEXT NOT NULL,
    risk_level TEXT,                -- 'LOW', 'MEDIUM', 'HIGH'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for ultra-fast query execution
CREATE INDEX IF NOT EXISTS idx_sales_contract_ref ON sales_transactions(contract_ref);
CREATE INDEX IF NOT EXISTS idx_sales_quarter ON sales_transactions(quarter);
CREATE INDEX IF NOT EXISTS idx_doc_records_doc_id ON document_records(doc_id);

-- Initial Enterprise Production Dataset (Real-world Sample Data for Testing)
INSERT OR IGNORE INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
VALUES 
    ('TX-1001', 'Acme Corporation', 'CTR-2024-001', 'Q1-2024', 150000.00, 'COMPLETED', '2024-03-15'),
    ('TX-1002', 'Acme Corporation', 'CTR-2024-001', 'Q2-2024', 120000.00, 'COMPLETED', '2024-06-20'),
    ('TX-1003', 'GlobalTech Industries', 'CTR-2024-002', 'Q1-2024', 300000.00, 'COMPLETED', '2024-03-28'),
    ('TX-1004', 'GlobalTech Industries', 'CTR-2024-002', 'Q2-2024', 250000.00, 'COMPLETED', '2024-06-28'),
    ('TX-1005', 'Nexus Financial LLC', 'CTR-2024-003', 'Q2-2024', 85000.00, 'COMPLETED', '2024-06-10');
