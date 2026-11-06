FinLegal runs with server-enforced demo limits. `/api/limits` publishes the current limits to the frontend.

- Files: PDF with selectable text, DOCX, TXT, CSV or MD; maximum 3 MiB and 40,000 extracted characters, then at most 40 chunks. Oversized documents are rejected, not silently truncated. DOCX XML is limited during decompression. AI OCR and remote extraction are disabled for this demo.
- Storage: at most 3 active documents in the shared demo library, including failed uploads. Delete an unwanted document to free a slot. The D1 slot reservation is atomic.
- Questions: at most 2,000 characters, with at most 4 history messages totaling 4,000 characters. Model inputs are limited to 24,000 characters, outputs to 1,024 tokens, and each query to 6 upstream generation attempts. Small routing/rewrite/SQL tasks default to 256 output tokens.
- Chat quota: 5 requests per 10-minute window and 20 per day per Cloudflare-provided IP; 100 per day for the entire demo.
- Ingestion quota: 3 requests per 10-minute window and 5 per day per IP; 20 per day for the entire demo. Upload, version, reparse and sample routes share this quota. Accepted attempts count even if later processing fails; reservations are not refunded.
- Windows are fixed UTC buckets. Limits are stored atomically in D1 and cannot be bypassed by refreshing the page or changing client tenant/session headers. Missing IPs share the `unknown` bucket. Database failures refuse AI work with a retry message instead of disabling the quota.
- DeepSeek uses only the configured Worker secret and one primary attempt. It falls back once to a smaller Workers AI model, with no automatic paid Pro/reasoning-model cascade. Ingestion does not repeat the whole pipeline, and queue deliveries stop after at most two attempts. Provider outages can still consume a reserved request.

The `demo_usage` table is created automatically for existing databases and included in the schema for new databases. This is a bound on requests, content and generation sizes, not a monetary billing cap; provider-side spending limits remain separate.

Run `npm run test:demo` for real local D1 concurrency, API rejection, parsing and model-budget checks. Tests use local Miniflare and mocked models; they make no paid inference calls.
