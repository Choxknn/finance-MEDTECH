# finance MEDTECH — เวอร์ชันเริ่มต้น

ระบบเงินกองกลาง MEDTECH ภาษาไทย ออกแบบสำหรับมือถือและเดสก์ท็อป

## ทดลองทันที

เปิด `web/index.html` ในเบราว์เซอร์ แล้วเลือก **ทดลองหน้าสมาชิก** หรือ **ทดลองหน้าแอดมิน**

ข้อมูลตัวอย่างอยู่ในหน่วยความจำเท่านั้น เมื่อโหลดหน้าใหม่จะกลับค่าเริ่มต้น ไม่มีการตรวจสลิปจริง อัปโหลด Drive หรือส่ง LINE ในโหมดทดลอง หลังส่งสลิปให้ใช้ปุ่ม “ลองหน้าแอดมิน” เพื่อตรวจรายการเดียวกันได้

## สิ่งที่มีแล้ว

- หน้าสมาชิก: สรุปยอด เรียกเก็บ แจ้งชำระบางส่วน แนบสลิป ประวัติ ใบรับเงินพิมพ์/PDF เงินกองกลาง โปรไฟล์ และเปลี่ยนรหัสผ่าน
- หน้าแอดมิน: สร้างรอบเก็บเงินให้สมาชิกที่เปิดใช้งาน เพิ่มบัญชีนักศึกษา ตรวจสลิป ยืนยัน/ส่งกลับแก้ไข บันทึกรายจ่ายพร้อมหลักฐาน รายงาน CSV และประวัติการทำงาน
- โค้ด Supabase: ตารางฐานข้อมูล สิทธิ์ปิดการเขียนจากหน้าเว็บ ธุรกรรมป้องกันยอดเกินและเลขอ้างอิงซ้ำ Edge Functions สำหรับบริการภายนอก
- Google Drive: อัปโหลดภาพลงโฟลเดอร์ส่วนตัว เปิดหลักฐานผ่านเซิร์ฟเวอร์หลังตรวจสิทธิ์
- SlipOK: ส่ง `files`, `log=true`, `amount` เพื่อตรวจยอด ผู้รับที่ผูกกับสาขา และสลิปซ้ำ ตรวจวันที่ก่อนยืนยันอัตโนมัติ ผลไม่แน่นอนเข้าคิวให้แอดมิน
- LINE OA: สร้างรหัสเชื่อมบัญชีใช้ครั้งเดียว มีอายุ 10 นาที ตรวจลายเซ็น webhook แจ้งผลชำระและให้แอดมินส่งเตือนยอดค้าง พร้อมบันทึกสถานะส่ง
- GitHub Actions: พร้อมเผยแพร่โฟลเดอร์ `web` บน GitHub Pages

## สถานะและขอบเขต

หน้าเว็บทำงานในโหมดทดลองเป็นค่าเริ่มต้น โค้ดเชื่อมต่อบริการจัดเตรียมไว้ แต่ยังไม่ได้ติดตั้งในบัญชีจริงหรือทดสอบด้วยรายการโอนจริง จึงยังไม่ควรนำไปรับเงินจริงจนทดสอบครบ

ยังไม่รวม: นำเข้ารายชื่อ CSV, ปิดบัญชี/รีเซ็ตรหัสผ่านผ่านหน้าแอดมิน, แจ้งเตือนตามเวลาอัตโนมัติ, ปรับยอดเฉพาะคน, คืนเงิน, รายจ่าย PDF, กระบวนการกู้รหัสผ่านอัตโนมัติ และส่งข้อความซ้ำจากหน้าจอ

การเข้าสู่ระบบจริงเก็บเซสชันในหน่วยความจำ ต้องเข้าสู่ระบบใหม่เมื่อโหลดหน้าและเมื่อ token หมดอายุ ไม่มีการจำรหัสผ่าน สมาชิกใหม่ไม่ได้ถูกเพิ่มเข้ารอบเก็บเงินเก่าโดยอัตโนมัติ

## ตั้งค่า Supabase

1. สร้างโปรเจกต์ Supabase ใหม่ เปิดใช้ Email/Password Auth และปิดการสมัครสมาชิกสาธารณะ (สร้างบัญชีโดยแอดมินเท่านั้น)
2. ใช้ SQL Editor รัน `supabase/migrations/001_initial.sql` ครั้งเดียวในโปรเจกต์ใหม่
3. ติดตั้ง Supabase CLI ตามเอกสาร แล้วจากโฟลเดอร์นี้รัน:

```sh
supabase login
supabase link --project-ref sdegiugcttarbsnqvusm
supabase secrets set --env-file secrets.env
supabase functions deploy finance-api
supabase functions deploy line-webhook
```

`supabase/config.toml` ปิด gateway JWT check เพราะ `finance-api` ตรวจ token กับ Supabase Auth เองทุกคำขอ ส่วน `line-webhook` ตรวจ HMAC จาก LINE ไม่เปิดข้อมูลโดยอาศัยค่า role จากหน้าเว็บ

4. คัดลอก `.env.example` เป็น `secrets.env` ใส่ค่าบริการจริง แล้วอย่า commit ไฟล์นี้
5. ตั้ง `ALLOWED_ORIGINS` เป็น origin เท่านั้น เช่น `https://yourname.github.io` ไม่ใส่เส้นทาง repository ใช้ comma แยกหลาย origin ได้
6. สร้างแอดมินครั้งแรกด้วย `scripts/create-admin.mjs` บนเครื่องที่เชื่อถือได้ โดยใส่ค่า environment `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_STUDENT_ID`, `ADMIN_NAME`, `ADMIN_PASSWORD` แล้วรัน `node scripts/create-admin.mjs` ห้ามใส่ secret ลงใน GitHub หรือส่งรหัสผ่านในแชต
7. ภายในใช้บัญชี email ที่แมปจากรหัสนักศึกษาเป็น `รหัส@students.finance-medtech.invalid` ผู้ใช้กรอกเฉพาะรหัสนักศึกษา ไม่ได้ส่งเมลไปโดเมนนี้ หากเปลี่ยนโดเมนให้ตั้งทั้งหน้าเว็บและ server ให้ตรงกัน ไม่รองรับกู้รหัสผ่านผ่าน email แบบนี้

## Google Drive

- เปิด Google Drive API ใน Google Cloud สร้าง OAuth client และขอ offline access เพื่อรับ refresh token ของบัญชีที่เป็นเจ้าของโฟลเดอร์
- ใช้ scope ที่ครอบคลุมโฟลเดอร์ที่เลือก บัญชี OAuth ต้องมีสิทธิ์สร้างและอ่านไฟล์ในโฟลเดอร์ดังกล่าว (scope `drive.file` ต้องให้แอปเข้าถึงโฟลเดอร์นั้นอย่างถูกต้อง)
- ตั้ง `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID` เป็น Supabase secrets
- โฟลเดอร์ต้องจำกัดสิทธิ์ ห้ามตั้ง anyone with the link เพราะไฟล์ใหม่สืบทอดสิทธิ์โฟลเดอร์ โค้ดไม่สร้าง public sharing
- ถ้าใช้ OAuth consent ในโหมด Testing ให้ตรวจข้อจำกัดอายุ refresh token ก่อนเปิดใช้งานระยะยาว
- เก็บนโยบายสำรองและลบหลักฐานแยกตามข้อกำหนดของกลุ่ม

## SlipOK

ตั้ง `SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY` และผูก **บัญชีรับเงินที่ถูกต้องกับสาขา API** ใน SlipOK ให้เรียบร้อย ระบบใช้ `log=true` เพื่อให้ SlipOK ตรวจบัญชีผู้รับและตรวจสลิปซ้ำด้วย

ไฟล์รองรับ JPG/PNG/WEBP สูงสุด 5 MB ตรวจ MIME และลายเซ็นไฟล์ฝั่งเซิร์ฟเวอร์ ผลที่ตรวจไม่ผ่านหรือบริการล่มไม่เพิ่มยอดรับ แต่เก็บหลักฐานและเข้าคิวตรวจเอง แอดมินยืนยันเองต้องมีเลขอ้างอิงและหมายเหตุ

หาก upload สำเร็จแต่เขียนฐานข้อมูลล้มเหลวอาจมีไฟล์กำพร้าใน Drive ให้ตรวจชื่อไฟล์ `slip-<payment-id>` กับฐานข้อมูล เมื่อระบบล่มกลางขั้นตอน อาจมีสถานะ pending ค้าง แอดมินตรวจหลักฐานแล้วอนุมัติหรือส่งกลับแก้ไขได้ ห้ามยืนยันโดยไม่ตรวจบัญชีผู้รับ ยอด วันเวลา และเลขอ้างอิง

## LINE OA

1. เปิด Messaging API สำหรับ OA ของกลุ่ม
2. ตั้ง `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` ใน Supabase secrets
3. ตั้ง webhook URL เป็น `https://sdegiugcttarbsnqvusm.supabase.co/functions/v1/line-webhook` และเปิดใช้ webhook
4. สมาชิกเพิ่ม OA เป็นเพื่อน เข้าหน้าโปรไฟล์ สร้างรหัส แล้วส่ง `เชื่อม รหัส` ในแชตส่วนตัวกับ OA
5. ทดสอบแจ้งชำระและปุ่มแจ้งเตือนของแอดมิน

บันทึกสถานะ `sent` หมายถึง LINE รับคำขอแล้ว ไม่ยืนยันว่าผู้ใช้ได้อ่าน มี retry key เก็บไว้ แต่เวอร์ชันนี้ยังไม่มี worker ส่งข้อความ failed ซ้ำอัตโนมัติ การเตือนก่อนครบกำหนดแบบตั้งเวลายังต้องเพิ่ม scheduler

## หน้าเว็บและ GitHub Pages

แก้ไข `web/config.js`:

- `mode: 'live'` เมื่อระบบเบื้องหลังพร้อม
- `supabaseUrl`, `supabaseAnonKey` (public anon/publishable key เท่านั้น)
- `studentEmailDomain` ให้ตรงฝั่งเซิร์ฟเวอร์
- `bankName`, `accountName`, `accountNumber`, `paymentQrUrl` ใช้ QR จากบัญชีจริง
- `lineOaUrl` เช่นลิงก์เพิ่มเพื่อนของ OA

ห้ามใส่ service role, Google OAuth secret, SlipOK API key หรือ LINE token ใน `config.js`

สร้าง GitHub repository อัปโหลด **เนื้อหาภายในโฟลเดอร์ finance-medtech** ให้ `web/`, `supabase/`, `.github/` อยู่ที่ราก repository เลือก Settings → Pages → Source → GitHub Actions แล้ว workflow จะเผยแพร่หน้าเว็บเมื่อ push ไป `main` ตรวจข้อกำหนดแผน GitHub สำหรับ repository ของคุณด้วย

ยังไม่มีการสร้าง repository หรือเผยแพร่เว็บให้บัญชีใดในชุดไฟล์นี้ หน้าเว็บของ GitHub Pages ที่เผยแพร่อาจเข้าถึงได้สาธารณะ แม้ฐานข้อมูลและหลักฐานจะต้องเข้าสู่ระบบ จึงต้องตรวจการตั้งค่าการเข้าถึงก่อนเผยแพร่

## ทดสอบก่อนใช้งานเงินจริง

- บัญชีสมาชิก A เปิดไฟล์/รายการของ B ต้องไม่ได้ และสมาชิกต้องเรียก action แอดมินไม่ได้
- ตรวจสลิปผ่านจริง: ยอด ผู้รับ วันที่ และเลขอ้างอิงถูกต้อง จึงเพิ่มยอดเพียงครั้งเดียว
- สลิปซ้ำ ยอดไม่ตรง ผู้รับผิด บริการ SlipOK ล่ม และ Drive ล่ม ต้องไม่เพิ่มยอดอัตโนมัติ
- ทดลองชำระบางส่วน ส่งซ้ำพร้อมกัน และอนุมัติซ้ำ ยอดรวมต้องไม่เกินเรียกเก็บ
- ตรวจ Google Drive ว่าไฟล์ไม่ได้แชร์สาธารณะ
- LINE รหัสผิด หมดอายุ ใช้ซ้ำ และ webhook ลายเซ็นผิดต้องไม่เชื่อมบัญชี
- ตรวจค่าใช้จ่าย ใบรับเงิน และ CSV ให้ตรงรายการจริง

## เอกสารอ้างอิง

- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://slipok.com/api-documentation/check-slip/
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- https://developers.line.biz/en/reference/messaging-api/#send-push-message
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
