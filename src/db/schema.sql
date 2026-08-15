-- ====================================================================
-- Lexifin Database Schema (Cloudflare D1 Serverless SQLite)
-- Production Ready Schema for RAG Document System
-- ====================================================================

-- 1. Sales & Revenue Transactions Table (Audit Data)
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

-- 2. Document Registry Metadata Table (Flow A & Flow C Lifecycle Tracking)
CREATE TABLE IF NOT EXISTS document_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    tenant_id TEXT DEFAULT 'tenant_default',
    user_id TEXT DEFAULT 'user_default',
    version TEXT DEFAULT 'v1',
    is_active INTEGER DEFAULT 1,     -- 1 = Active version, 0 = Inactive / Superseded
    parent_doc_id TEXT,             -- Reference to previous version ID if updated
    total_pages INTEGER NOT NULL DEFAULT 1,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    processing_status TEXT DEFAULT 'UPLOADED', -- 'UPLOADING', 'UPLOADED', 'EXTRACTING', 'STRUCTURING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED', 'DELETING', 'DELETED'
    processing_version TEXT DEFAULT 'v3.0',
    pipeline_version TEXT DEFAULT 'v1.0',
    parser_version TEXT DEFAULT 'v1.0',
    chunker_version TEXT DEFAULT 'v1.0',
    embedding_model TEXT DEFAULT '@cf/baai/bge-m3',
    extraction_method TEXT,
    processed_at DATETIME,
    indexed_at DATETIME,
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    uploaded_by TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Document Section Hierarchy Table (Structure Analyzer)
CREATE TABLE IF NOT EXISTS document_sections (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    tenant_id TEXT DEFAULT 'tenant_default',
    title TEXT,
    section_path TEXT NOT NULL,     -- JSON array string, e.g. ["Điều 7", "Khoản 7.2"]
    page_start INTEGER,
    page_end INTEGER,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES document_records(doc_id) ON DELETE CASCADE
);

-- 4. Structure-Aware Document Chunks Table (Chunking Engine)
CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    tenant_id TEXT DEFAULT 'tenant_default',
    section_id TEXT,
    chunk_index INTEGER NOT NULL,
    chunk_type TEXT NOT NULL,       -- 'paragraph', 'section', 'table', 'clause'
    content TEXT NOT NULL,
    token_count INTEGER,
    content_hash TEXT,
    pipeline_version TEXT DEFAULT 'v1.0',
    parser_version TEXT DEFAULT 'v1.0',
    chunker_version TEXT DEFAULT 'v1.0',
    embedding_model TEXT DEFAULT '@cf/baai/bge-m3',
    embedding_version TEXT DEFAULT 'bge-m3-v1',
    page_start INTEGER,
    page_end INTEGER,
    metadata_json TEXT NOT NULL,
    vector_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES document_records(doc_id) ON DELETE CASCADE
);

-- 5. Audit & Chat Execution Telemetry Logs Table
CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    tenant_id TEXT DEFAULT 'tenant_default',
    user_prompt TEXT NOT NULL,
    intent TEXT NOT NULL,           -- 'RAG_ONLY', 'SQL_ONLY', 'HYBRID_AUDIT', 'GENERAL_CHAT'
    thought_process TEXT NOT NULL,  -- JSON string of step-by-step reasoning
    final_response TEXT NOT NULL,
    risk_level TEXT,                -- 'LOW', 'MEDIUM', 'HIGH'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Anti-Spam IP Rate Limits Table
CREATE TABLE IF NOT EXISTS ip_rate_limits (
    ip TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 0,
    reset_at INTEGER NOT NULL
);

-- Indexes for fast query execution
CREATE INDEX IF NOT EXISTS idx_sales_contract_ref ON sales_transactions(contract_ref);
CREATE INDEX IF NOT EXISTS idx_sales_quarter ON sales_transactions(quarter);
CREATE INDEX IF NOT EXISTS idx_doc_records_doc_id ON document_records(doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_records_status ON document_records(processing_status);
CREATE INDEX IF NOT EXISTS idx_doc_records_active ON document_records(is_active);
CREATE INDEX IF NOT EXISTS idx_doc_sections_doc_id ON document_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc_id ON document_chunks(document_id);

-- Initial Enterprise Production Dataset (Sample Sales Data)
INSERT OR IGNORE INTO sales_transactions (transaction_id, customer_name, contract_ref, quarter, revenue_usd, status, transaction_date)
VALUES 
    ('TX-1001', 'Acme Corporation', 'CTR-2024-001', 'Q1-2024', 150000.00, 'COMPLETED', '2024-03-15'),
    ('TX-1002', 'Acme Corporation', 'CTR-2024-001', 'Q2-2024', 120000.00, 'COMPLETED', '2024-06-20'),
    ('TX-1003', 'GlobalTech Industries', 'CTR-2024-002', 'Q1-2024', 300000.00, 'COMPLETED', '2024-03-28'),
    ('TX-1004', 'GlobalTech Industries', 'CTR-2024-002', 'Q2-2024', 250000.00, 'COMPLETED', '2024-06-28'),
    ('TX-1005', 'Nexus Financial LLC', 'CTR-2024-003', 'Q2-2024', 85000.00, 'COMPLETED', '2024-06-10');


