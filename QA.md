# ผลตรวจสอบเวอร์ชันเริ่มต้น

ตรวจเมื่อ 30 กันยายน 2569

## ผ่าน

- ตรวจไวยากรณ์ JavaScript หน้าเว็บด้วย Node
- แปลง TypeScript ของ finance-api, line-webhook และ services ด้วย esbuild เพื่อยืนยันไวยากรณ์และ imports ภายใน
- ทดสอบ SQL กับ PostgreSQL-compatible PGlite: ติดตั้ง schema, สร้างรอบและยอดรายบุคคล, ป้องกันจ่ายแทนเจ้าของรายการ, จำกัดรายการค้างตรวจต่อยอดเรียกเก็บ, ไม่อนุมัติเมื่อไม่มีหลักฐาน, อนุมัติซ้ำไม่ได้, ป้องกันยอดเกินและเลขอ้างอิงซ้ำ, ชำระบางส่วนรวมถูกต้อง, รหัส LINE ใช้ครั้งเดียว/หมดอายุ, จำกัดตารางและ RPC จาก authenticated role
- ทดสอบเบราว์เซอร์ Chromium ด้วยข้อมูลทดลอง: ส่งสลิป 100 บาท, สลับหน้าแอดมินแล้วยืนยัน, ยอดรับเพิ่มถูกต้อง, สร้างรอบใหม่ให้สมาชิก, ค้นหาสมาชิก และดาวน์โหลด CSV
- ตรวจหน้าจอขนาด 390, 768 และ 1440 พิกเซล ไม่มี horizontal overflow ระดับหน้า เมนูมือถือใช้งานได้ ตารางเลื่อนแนวนอนได้
- ตรวจภาพหน้าสมาชิกเดสก์ท็อปและมือถือ ฟอนต์ไทยรวมในไฟล์ ไม่ต้องเรียก Google Fonts
- ไม่พบ page JavaScript error ในขั้นตอนที่ทดสอบ

## ยังไม่ได้ตรวจด้วยบัญชีจริง

- Supabase Auth/Edge Functions บนโปรเจกต์ของผู้ใช้
- Google OAuth สิทธิ์โฟลเดอร์และการอัปโหลด/เปิดไฟล์จริง
- SlipOK ผลผ่าน/ไม่ผ่านและบัญชีรับเงินจริง
- LINE webhook, ผูกบัญชี, push และโควตาของ OA จริง
- GitHub Actions และ GitHub Pages บน repository ของผู้ใช้
- การส่งคำขอพร้อมกันหลายเครื่อง/โหลดสูง และการกู้คืนบริการล่มกลางขั้นตอน

ผลทดสอบโหมดทดลองและฐานข้อมูลในเครื่องไม่ใช่การรับรองว่าการเชื่อมต่อภายนอกพร้อมใช้งานเงินจริง ทำการทดสอบตาม README หลังตั้งค่าบริการจริงก่อนเปิดรับเงิน

## Record windows and admin bill status — 2026-10-06
- Existing 19 Node test suites pass, including automatic reference selection and forged-actor protection.
- `tests/admin-bill-status.sql` passes against Supabase within a rolled-back fixture transaction: partial payment settlement, repeat-request idempotency, unpaid reversal, retained bank references/history, stale totals, member denial, pending-slip guard and service-only RPC permissions.
- `scripts/modal-browser-qa.cjs` checks record/bill windows, status edits, background scroll locking, nested modal replacement, Escape restoration, mobile overflow and separate Thai date/time fields using demo data only. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` to installed browser tooling.
- Admin status editing supports paid/unpaid. Pending slips must be reviewed before changing the bill status. Reversing payment retains evidence and bank references; it removes the approved amount from fund totals.
- Manual confirmation keeps any saved SlipOK bank reference. If none exists, it creates a clearly marked `ADMIN-…` internal reference; client reference overrides are ignored.

## Fund groups / LINE destinations
- Browser demo QA: category normalization/group totals, add/reuse categories, receipt totals, penalty icons, destination editing, member privacy and mobile width.
- SQL rollback fixtures: category deduplication, settings preservation, destination validation, duplicate-recipient rejection and admin/service-only permissions.
- Bootstrap API test: only approved active payments enter receipt totals; member responses exclude other users' evidence and all LINE destination IDs.
- No LINE messages were sent during verification.
