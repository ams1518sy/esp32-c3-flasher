AMS ESP32-C3 Native USB Auto Boot/Reset Fix

แก้จากไฟล์ล่าสุดของผู้ใช้ คง UI / BIN merger / ROM flasher เดิม
- Native USB Serial/JTAG: ใช้ลำดับ DTR/RTS ตาม Espressif TRM (D0 R0 D1 R0 R1 D0 R1 R0)
- ค้างสัญญาณขอเข้า Download Mode 2 วินาทีก่อนจบขั้นตอน reset (Native USB ไม่ใช่ GPIO BOOT จริง)
- Auto Reset หลังแฟลช: D0 R0 R1 R0
- USB-UART: ค้าง BOOT หลังปล่อย RESET 2 วินาที

เปิด START_SERVER.bat แล้วเข้า http://localhost:8000 กด Ctrl+F5
เลือก COM4 USB JTAG/serial debug unit, เลือก Native USB Serial/JTAG
ปิด Serial Monitor และเว็บแฟลชอื่นก่อนทดลอง

ยังไม่ผ่านการทดสอบกับบอร์ดจริง หากยังล้มเหลวส่ง Log กลับมา
