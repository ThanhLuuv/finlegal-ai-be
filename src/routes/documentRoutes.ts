// Document Routes - Upload, CRUD, Parsing, Versioning & Stage 3 Synchronized Deletion

import { Hono } from 'hono';
import { Bindings } from '../index';
import { IngestionConsumer } from '../core/pipeline/ingestionConsumer';
import { D1DocumentRepository } from '../storage/d1DocumentRepository';
import { VectorRepository } from '../storage/vectorRepository';
import { R2DocumentRepository } from '../storage/r2Repository';
import { generatePdfBufferFromText, isValidPdfBuffer } from '../utils/pdfGenerator';

export const documentRoutes = new Hono<{ Bindings: Bindings }>();

// 1. Seed Sample Contract Document Endpoint for Recruiter/Demo Testing
documentRoutes.post('/seed-sample', async (c) => {
  try {
    const docId = `doc_demo_${Date.now()}`;
    const fileName = 'Hop_dong_mua_ban_hang_hoa_mau.pdf';

    try {
      await c.env.DB.prepare(
        `UPDATE document_records SET is_active = 0 WHERE file_name = ?`
      ).bind(fileName).run();
    } catch {}

    const sampleContractContent = `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---
HỢP ĐỒNG MUA BÁN HÀNG HÓA MẪU DÙNG THỬ
Số: 01/2024/HĐMB-LEXIFIN

Hôm nay, ngày 15 tháng 01 năm 2024, tại trụ sở Công ty.
Chúng tôi gồm có:

BÊN BÁN (BÊN A): CÔNG TY TNHH THƯƠNG MẠI & DỊCH VỤ LEXIFIN
- Đại diện: Ông Nguyễn Văn An - Chức vụ: Giám đốc
- Địa chỉ: Tầng 8, Tòa nhà LexiFin Tower, Quận 1, TP. Hồ Chí Minh
- Mã số thuế: 0312345678 - Điện thoại: (028) 3822 9999

BÊN MUA (BÊN B): CÔNG TY CỔ PHẦN CÔNG NGHỆ TOÀN CẦU (GLOBALTECH)
- Đại diện: Bà Trần Thị Bình - Chức vụ: Tổng Giám đốc
- Địa chỉ: Khu Công nghệ cao, Thành phố Thủ Đức, TP. Hồ Chí Minh
- Mã số thuế: 0398765432 - Điện thoại: (028) 3730 8888

ĐIỀU 1: ĐỐI TƯỢNG HỢP ĐỒNG VÀ GIÁ TRỊ
1. Bên A đồng ý bán và Bên B đồng ý mua hệ thống thiết bị kiểm toán tự động.
2. Tổng giá trị hợp đồng: 1.500.000.000 VNĐ (Một tỷ năm trăm triệu đồng chẵn).
3. Giá trên đã bao gồm thuế Giá trị gia tăng (VAT 10%) và chi phí vận chuyển, lắp đặt.

ĐIỀU 2: PHƯƠNG THỨC VÀ THỜI HẠN THANH TOÁN
1. Đợt 1: Bên B thanh toán 30% giá trị hợp đồng (tương đương 450.000.000 VNĐ) trong vòng 05 ngày làm việc sau khi ký hợp đồng.
2. Đợt 2: Bên B thanh toán 60% giá trị hợp đồng sau khi nghiệm thu giao nhận hàng hóa.
3. Đợt 3: Bên B thanh toán 10% còn lại sau 30 ngày bảo hành.

ĐIỀU 3: BẢO HÀNH VÀ ĐIỀU KHOẢN PHẠT VI PHẠM
1. Thời gian bảo hành: 12 tháng kể từ ngày ký biên bản nghiệm thu.
2. Phạt chậm giao hàng: Nếu Bên A chậm giao hàng quá 10 ngày, phạt 0.5% giá trị hợp đồng cho mỗi ngày chậm trễ, nhưng không quá 10% tổng giá trị hợp đồng.

ĐIỀU 4: ĐIỀU KHOẢN CHUNG
Hợp đồng này được lập thành 04 bản có giá trị pháp lý như nhau, mỗi bên giữ 02 bản.`;

    let pdfBuffer: ArrayBuffer | null = null;
    try {
      const res = await fetch('https://finlegal-ai.pages.dev/Hop_dong_mua_ban_hang_hoa_mau.pdf');
      if (res.ok) {
        pdfBuffer = await res.arrayBuffer();
      }
    } catch {}

    if (!pdfBuffer || pdfBuffer.byteLength === 0) {
      pdfBuffer = generatePdfBufferFromText('Hợp đồng mua bán hàng hóa mẫu', sampleContractContent);
    }

    const consumer = new IngestionConsumer(
      c.env.DB, 
      c.env.VECTORIZE, 
      c.env.R2, 
      c.env.AI, 
      (c.env as any).DOCUMENT_SERVICE_URL, 
      (c.env as any).SERVICE_SECRET_TOKEN
    );
    await consumer.processIngestionJob(docId, fileName, pdfBuffer);

    try {
      await c.env.DB.prepare('UPDATE document_records SET is_demo = 1 WHERE doc_id = ?').bind(docId).run();
    } catch {}

    return c.json({ success: true, docId, message: 'Đã nạp tài liệu mẫu dùng thử thành công!' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể nạp dữ liệu mẫu: ${errorMsg}` }, 500);
  }
});

// 2. Document Records List Endpoint
documentRoutes.get('/', async (c) => {
  try {
    const d1Repo = new D1DocumentRepository(c.env.DB);
    try {
      await c.env.DB.prepare(
        `UPDATE document_records SET is_demo = 1 WHERE file_name LIKE 'Hop_dong_mua_ban%' OR doc_id LIKE '%demo%'`
      ).run();
    } catch {}

    const documents = await d1Repo.listActiveDocuments();
    return c.json({ documents });
  } catch {
    return c.json({ documents: [] });
  }
});

// 3. Single Document Record Fetch & Status Stream
documentRoutes.get('/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);
    if (!doc) return c.json({ error: 'Không tìm thấy tài liệu' }, 404);
    return c.json({ document: doc });
  } catch {
    return c.json({ error: 'Lỗi truy vấn tài liệu' }, 500);
  }
});

documentRoutes.get('/:docId/status', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);
    if (!doc) return c.json({ error: 'Không tìm thấy tài liệu' }, 404);
    return c.json({
      docId: doc.doc_id,
      fileName: doc.file_name,
      status: doc.processing_status || 'UPLOADED',
      totalPages: doc.total_pages || 1,
      totalChunks: doc.total_chunks || 0,
      extractionMethod: doc.extraction_method || 'bge_m3_pipeline',
      processedAt: doc.processed_at || doc.created_at,
      isReady: doc.processing_status === 'READY'
    });
  } catch {
    return c.json({ error: 'Lỗi kiểm tra trạng thái' }, 500);
  }
});

documentRoutes.get('/:docId/chunks', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const chunks = await d1Repo.getAllChunks(docId);
    return c.json({
      docId,
      totalChunks: chunks.length,
      chunks
    });
  } catch {
    return c.json({ error: 'Lỗi truy vấn danh sách chunks' }, 500);
  }
});

// 4. Direct Document File View / Preview Endpoint
documentRoutes.get('/:docId/view', async (c) => {
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

    const arrayBuffer = await r2Object.arrayBuffer();
    const ext = (doc.file_name || '').split('.').pop()?.toLowerCase() || '';
    const hasPdfMagic = isValidPdfBuffer(arrayBuffer);

    let contentType = 'application/octet-stream';
    if (ext === 'pdf') {
      contentType = hasPdfMagic ? 'application/pdf' : 'text/plain; charset=utf-8';
    } else if (ext === 'docx') {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === 'txt') {
      contentType = 'text/plain; charset=utf-8';
    } else if (ext === 'csv') {
      contentType = 'text/csv; charset=utf-8';
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.file_name)}"`);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(arrayBuffer, {
      status: 200,
      headers
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể xem tài liệu: ${errorMsg}` }, 500);
  }
});

// 5. Stage 3 Synchronized Idempotent Delete Document Endpoint (Vectorize + D1 + R2)
documentRoutes.delete('/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);

    if (doc && (Number((doc as any).is_demo) === 1 || docId.toLowerCase().includes('demo') || doc.file_name?.includes('Hop_dong_mua_ban'))) {
      return c.json({ error: 'PROTECTED_DOCUMENT: Tài liệu mẫu hệ thống không thể xóa.' }, 400);
    }

    const vectorRepo = new VectorRepository(c.env.VECTORIZE, c.env.AI);
    const r2Repo = new R2DocumentRepository(c.env.R2);

    await d1Repo.updateStatus(docId, 'DELETING', { errorMessage: 'Document deletion in progress' });

    // 1. Delete Vectors from Cloudflare Vectorize
    const d1VectorIds = await d1Repo.getChunkVectorIds(docId);
    const generatedChunkIds = Array.from({ length: 300 }, (_, i) => `${docId}_chunk_${i}`);
    const allIdsToDelete = Array.from(new Set([...d1VectorIds, ...generatedChunkIds]));

    try {
      await vectorRepo.deleteByIds(allIdsToDelete);
    } catch (vecErr) {
      console.warn('Vectorize deletion notice:', vecErr);
    }

    // 2. Delete original file and chunk text objects from Cloudflare R2
    await r2Repo.deleteDocumentAndChunks(docId, doc?.r2_key);

    // 3. Delete metadata records from Cloudflare D1
    await d1Repo.deleteDocumentRecord(docId);

    return c.json({ success: true, message: 'Đã xóa đồng bộ tài liệu khỏi Cloudflare Vectorize, D1 và R2 thành công.' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể xóa tài liệu: ${errorMsg}` }, 500);
  }
});

// 6. Document Upload Endpoint (Stage 1 Async Queue Ingestion Pipeline - Flow §8)
documentRoutes.post('/', async (c) => {
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

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const allowedExts = ['pdf', 'docx', 'txt', 'csv', 'md'];
    if (!allowedExts.includes(ext)) {
      return c.json({ error: `INVALID_FILE: Định dạng file .${ext} chưa hỗ trợ (Hỗ trợ .pdf, .docx, .txt, .csv, .md).` }, 400);
    }

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return c.json({ error: 'INVALID_FILE: Tập tin tải lên bị rỗng hoặc không đúng định dạng.' }, 400);
    }

    if (arrayBuffer.byteLength > 25 * 1024 * 1024) {
      return c.json({ error: 'INVALID_FILE: Dung lượng file vượt quá giới hạn 25MB.' }, 400);
    }

    const docId = `doc_${Date.now()}`;
    const r2Repo = new R2DocumentRepository(c.env.R2);
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const consumer = new IngestionConsumer(
      c.env.DB, 
      c.env.VECTORIZE, 
      c.env.R2, 
      c.env.AI, 
      (c.env as any).DOCUMENT_SERVICE_URL, 
      (c.env as any).SERVICE_SECRET_TOKEN
    );

    // Step 1: Save raw original file to R2 & Initial D1 record with UPLOADED status
    const r2Key = await r2Repo.uploadDocument(docId, fileName, arrayBuffer);
    await d1Repo.createInitialRecord({
      docId,
      fileName,
      r2Key,
      version: 'v1'
    });

    // Step 2: Dispatch Async Queue Job or Background Worker execution (Flow §8)
    if (c.env.INGESTION_QUEUE) {
      await c.env.INGESTION_QUEUE.send({
        docId,
        fileName,
        r2Key,
        options: { version: 'v1', r2Key }
      });
    } else {
      // Background execution via waitUntil to prevent HTTP blocking timeout
      c.executionCtx.waitUntil(
        consumer.processIngestionJob(docId, fileName, arrayBuffer, { r2Key })
      );
    }

    return c.json({
      success: true,
      docId,
      fileName,
      status: 'UPLOADED',
      message: 'Tài liệu đã được tải lên thành công và đang được bóc tách dữ liệu không đồng bộ trong nền.'
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Lỗi xử lý tài liệu: ${errorMsg}` }, 500);
  }
});


// 7. Document Version Update Endpoint
documentRoutes.post('/:docId/version', async (c) => {
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
    const consumer = new IngestionConsumer(
      c.env.DB, 
      c.env.VECTORIZE, 
      c.env.R2, 
      c.env.AI, 
      (c.env as any).DOCUMENT_SERVICE_URL, 
      (c.env as any).SERVICE_SECRET_TOKEN
    );

    const result = await consumer.processIngestionJob(newDocId, fileName, arrayBuffer, {
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

// 8. Document Re-Parse & Re-Index Endpoint
documentRoutes.post('/:docId/reparse', async (c) => {
  try {
    const docId = c.req.param('docId');
    const d1Repo = new D1DocumentRepository(c.env.DB);
    const doc = await d1Repo.getDocumentRecord(docId);

    if (!doc || !doc.r2_key) {
      return c.json({ error: 'Tài liệu không tồn tại trên hệ thống lưu trữ R2.' }, 404);
    }

    const r2Object = await c.env.R2.get(doc.r2_key);
    if (!r2Object) {
      return c.json({ error: 'Tập tin gốc không tìm thấy trên R2 Storage.' }, 404);
    }

    const arrayBuffer = await r2Object.arrayBuffer();
    const vectorRepo = new VectorRepository(c.env.VECTORIZE, c.env.AI);
    const r2Repo = new R2DocumentRepository(c.env.R2);

    const d1VectorIds = await d1Repo.getChunkVectorIds(docId);
    const generatedChunkIds = Array.from({ length: 300 }, (_, i) => `${docId}_chunk_${i}`);
    const allIdsToDelete = Array.from(new Set([...d1VectorIds, ...generatedChunkIds]));

    try {
      await vectorRepo.deleteByIds(allIdsToDelete);
    } catch {}

    await r2Repo.deleteDocumentAndChunks(docId);
    await c.env.DB.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(docId).run();
    await c.env.DB.prepare('DELETE FROM document_sections WHERE document_id = ?').bind(docId).run();

    const consumer = new IngestionConsumer(
      c.env.DB, 
      c.env.VECTORIZE, 
      c.env.R2, 
      c.env.AI, 
      (c.env as any).DOCUMENT_SERVICE_URL, 
      (c.env as any).SERVICE_SECRET_TOKEN
    );
    const result = await consumer.processIngestionJob(docId, doc.file_name, arrayBuffer);

    return c.json({
      success: true,
      docId: result.docId,
      fileName: result.fileName,
      totalChunks: result.totalChunks,
      message: 'Đã phân tích lại (re-parse) tài liệu thành công!'
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Không thể re-parse tài liệu: ${errorMsg}` }, 500);
  }
});
