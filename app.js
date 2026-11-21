'use strict';
// AMS Techno ESP32-C3 offline ROM flasher — no external JavaScript dependencies.
// Uses Web Serial API and Espressif ROM serial bootloader protocol (SLIP frames).
// This is a minimal, uncompressed implementation; it is not esptool-js.
const $=id=>document.getElementById(id);
const log=(s)=>{const el=$('log');el.textContent+=`[${new Date().toLocaleTimeString()}] ${s}\n`;el.scrollTop=el.scrollHeight;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hex=n=>'0x'+n.toString(16).toUpperCase();
const HEADER=0xE9,MAX_FLASH=4*1024*1024;
let port=null,reader=null,writer=null,rom=null,firmware=null,active=false,cancelRequested=false,mode='parts';
const support=!!navigator.serial && window.isSecureContext;
$('support').textContent=support?'Web Serial พร้อมใช้งาน':'Web Serial ใช้ไม่ได้ในหน้านี้';
$('support').style.color=support?'#75e9ab':'#ffb4a8';
if(!support)log('ERROR: ต้องใช้ Chrome/Edge บน http://localhost หรือ HTTPS และเปิด Web Serial ได้');
else log('พร้อมใช้งาน: Web Serial พร้อม (ไม่มี CDN)');
function update(){ $('connect').disabled=!support||active||!!port;$('disconnect').disabled=!port||active;$('flash').disabled=!port||!firmware||active;$('cancel').disabled=!active;}
function setMode(m){mode=m;$('parts').hidden=m!=='parts';$('mergedBox').hidden=m!=='merged';$('tabParts').classList.toggle('selected',m==='parts');$('tabMerged').classList.toggle('selected',m==='merged');firmware=null;$('fileInfo').textContent='เลือกไฟล์สำหรับโหมดนี้';update();}
$('tabParts').onclick=()=>setMode('parts');$('tabMerged').onclick=()=>setMode('merged');
async function loadFile(id){const f=$(id).files[0];if(!f)throw Error(`ยังไม่ได้เลือก ${id}`);return new Uint8Array(await f.arrayBuffer());}
function merge(parts){let end=0;for(const p of parts){if(!p.data.length)throw Error('พบไฟล์ว่าง');if(p.offset+p.data.length>MAX_FLASH)throw Error('ไฟล์เกินขนาด Flash 4MB');end=Math.max(end,p.offset+p.data.length);}parts.sort((a,b)=>a.offset-b.offset);for(let i=1;i<parts.length;i++)if(parts[i-1].offset+parts[i-1].data.length>parts[i].offset)throw Error('ตำแหน่ง BIN ทับซ้อนกัน');const b=new Uint8Array(end);b.fill(0xff);for(const p of parts)b.set(p.data,p.offset);return b;}
async function makeMerged(){const boot=await loadFile('boot'),partition=await loadFile('partition'),app=await loadFile('app');if(boot[0]!==HEADER||app[0]!==HEADER)throw Error('Bootloader หรือ Application ไม่ใช่ ESP32 image (0xE9)');if(partition[0]!==0xaa||partition[1]!==0x50)throw Error('Partition Table magic ไม่ถูกต้อง');if(boot.length>0x8000)throw Error('Bootloader ยาวเกินพื้นที่ก่อน Partition Table');if(partition.length>0x8000)throw Error('Partition Table ยาวเกินพื้นที่ก่อน App');return merge([{offset:0x0000,data:boot},{offset:0x8000,data:partition},{offset:0x10000,data:app}]);}
function download(data,name){const url=URL.createObjectURL(new Blob([data],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('merge').onclick=async()=>{try{const b=await makeMerged();download(b,'ESP32_C3_MERGED.bin');log(`รวมสำเร็จ ${b.length.toLocaleString()} bytes (แฟลชที่ 0x0000)`);$('fileInfo').textContent=`รวมไฟล์สำเร็จ ${b.length.toLocaleString()} bytes`;}catch(e){log('ERROR: '+e.message);}};
$('useMerge').onclick=async()=>{try{firmware=await makeMerged();$('fileInfo').textContent=`เตรียมแฟลช Merged BIN ${firmware.length.toLocaleString()} bytes @ 0x0000`;log('เลือกไฟล์รวมจาก 3 ไฟล์แล้ว');update();}catch(e){log('ERROR: '+e.message);}};
$('merged').onchange=async()=>{try{const b=await loadFile('merged');if(b.length<0x10001||b.length>MAX_FLASH||b[0x0000]!==HEADER||b[0x8000]!==0xaa||b[0x8001]!==0x50||b[0x10000]!==HEADER)throw Error('Merged BIN ไม่ตรง Flash Map ESP32-C3 (Boot @ 0x0000, Partition @ 0x8000, App @ 0x10000)');firmware=b;$('fileInfo').textContent=`พร้อมแฟลชไฟล์รวม ${b.length.toLocaleString()} bytes ที่ Address 0x0000`; log('เลือก Merged BIN แล้ว');update();}catch(e){firmware=null;log('ERROR: '+e.message);update();}};
for(const id of ['boot','partition','app'])$(id).onchange=()=>{firmware=null;$('fileInfo').textContent='ไฟล์เปลี่ยนแล้ว กรุณากด “ใช้ไฟล์รวมนี้เพื่อแฟลช” อีกครั้ง';update();};
// Local MD5 for ROM flash verification. No external libraries.
function md5Hex(data){
 const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
 const k=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0);
 const len=data.length, padded=Math.ceil((len+9)/64)*64;
 const msg=new Uint8Array(padded);msg.set(data);msg[len]=128;
 const bitLo=(len*8)>>>0,bitHi=Math.floor(len/0x20000000)>>>0;
 const view=new DataView(msg.buffer);view.setUint32(padded-8,bitLo,true);view.setUint32(padded-4,bitHi,true);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
 for(let pos=0;pos<padded;pos+=64){let a=a0,b=b0,c=c0,d=d0;
  for(let i=0;i<64;i++){let f,g,s;
   if(i<16){f=(b&c)|(~b&d);g=i;s=shifts[i%4];}
   else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;s=shifts[4+i%4];}
   else if(i<48){f=b^c^d;g=(3*i+5)%16;s=shifts[8+i%4];}
   else{f=c^(b|~d);g=(7*i)%16;s=shifts[12+i%4];}
   const x=(a+f+k[i]+view.getUint32(pos+g*4,true))>>>0;
   const rotated=((x<<s)|(x>>>(32-s)))>>>0;
   const next=(b+rotated)>>>0;a=d;d=c;c=b;b=next;
  }
  a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
 }
 return [a0,b0,c0,d0].map(n=>[0,8,16,24].map(shift=>((n>>>shift)&255).toString(16).padStart(2,'0')).join('')).join('');
}
// Serial ROM packet helpers
const le32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
function frame(bytes){const out=[0xc0];for(const b of bytes){if(b===0xc0)out.push(0xdb,0xdc);else if(b===0xdb)out.push(0xdb,0xdd);else out.push(b);}out.push(0xc0);return Uint8Array.from(out);}
function xor(bytes){let n=0xef;for(const b of bytes)n^=b;return n>>>0;}
class ROM {
 constructor(port){this.port=port;this.rx=[];this.frames=[];this.current=[];this.escaped=false;this.started=false;this.running=false;this.readTask=null;}
 async start(){this.reader=this.port.readable.getReader();this.writer=this.port.writable.getWriter();this.running=true;this.readTask=this.pump();}
 async pump(){try{while(this.running){const {value,done}=await this.reader.read();if(done)break;for(const b of value){if(b===0xc0){if(this.started&&this.current.length)this.frames.push(Uint8Array.from(this.current));this.started=true;this.current=[];this.escaped=false;}else if(this.started){if(this.escaped){this.current.push(b===0xdc?0xc0:b===0xdd?0xdb:b);this.escaped=false;}else if(b===0xdb)this.escaped=true;else this.current.push(b);}}}}catch(e){if(this.running)log('Serial read: '+e.message);}}
 async command(op,data=new Uint8Array(),checksum=0,timeout=3500){const pkt=Uint8Array.from([0x00,op,data.length&255,(data.length>>>8)&255,...le32(checksum),...data]);await this.writer.write(frame(pkt));const start=Date.now();while(Date.now()-start<timeout){for(let i=0;i<this.frames.length;i++){const f=this.frames[i];if(f.length>=8&&f[0]===1&&f[1]===op){this.frames.splice(i,1);const payload=f.slice(8);if(payload.length>=2&&payload[payload.length-2]!==0)throw Error(`ROM command ${hex(op)} error status ${hex(payload[payload.length-2])}/${hex(payload[payload.length-1])}`);return {raw:f,value:(f[4]|f[5]<<8|f[6]<<16|f[7]<<24)>>>0,payload};}}await sleep(12);}throw Error(`Timeout รอคำตอบจาก ESP32 (command ${hex(op)})`);}
 async sync(){this.frames=[];const payload=Uint8Array.from([0x07,0x07,0x12,0x20,...Array(32).fill(0x55)]);for(let i=0;i<7;i++){try{await this.command(0x08,payload,0,500);return;}catch(e){await sleep(90);}}throw Error('เข้า ROM Download Mode ไม่สำเร็จ ตรวจสอบ BOOT/EN และสาย USB');}
 async attach(){// ESP32-C3 ROM SPI_ATTACH (hspi=0, legacy=0)
 await this.command(0x0d,Uint8Array.from([...le32(0),...le32(0)]),0,4000);}
 async eraseAll(){await this.command(0xd0,new Uint8Array(),0,30000);}
 async writeFlash(bytes,onProgress){const BLOCK=0x400;const count=Math.ceil(bytes.length/BLOCK);const begin=Uint8Array.from([...le32(count*BLOCK),...le32(count),...le32(BLOCK),...le32(0),...le32(0)]); // ROM FLASH_BEGIN: fifth uint32 = encryption disabled
 await this.command(0x02,begin,0,10000);for(let i=0;i<count;i++){if(cancelRequested)throw Error('ผู้ใช้ขอหยุดแฟลช');const block=new Uint8Array(BLOCK);block.fill(0xff);block.set(bytes.subarray(i*BLOCK,(i+1)*BLOCK));const packet=Uint8Array.from([...le32(BLOCK),...le32(i),...le32(0),...le32(0),...block]);await this.command(0x03,packet,xor(block),10000);onProgress(Math.round((i+1)*100/count));}await this.command(0x04,Uint8Array.from(le32(1)),0,5000);}
 async verifyFlash(bytes){
  // SPI_FLASH_MD5 (0x13) is implemented by ESP32-C3 ROM; ROM returns ASCII MD5.
  const paddedSize=Math.ceil(bytes.length/0x400)*0x400;
  const expectedBytes=new Uint8Array(paddedSize);expectedBytes.fill(0xff);expectedBytes.set(bytes);
  const expected=md5Hex(expectedBytes);
  const req=Uint8Array.from([...le32(0),...le32(paddedSize),...le32(0),...le32(0)]);
  const reply=await this.command(0x13,req,0,2500);
  const payload=reply.payload;
  const ascii=Array.from(payload.subarray(0,32)).map(x=>String.fromCharCode(x)).join('').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(ascii))throw Error('ROM ส่ง MD5 รูปแบบไม่ถูกต้อง: '+Array.from(payload).slice(0,40).map(x=>x.toString(16).padStart(2,'0')).join(' '));
  if(ascii!==expected)throw Error('VERIFY FAILED! Flash MD5 '+ascii+' ไม่ตรงกับ BIN '+expected);
  log('VERIFY PASS: Flash MD5 ตรงกับ BIN ('+ascii+')');
 }
 async stop(){this.running=false;try{await this.reader.cancel();}catch{}try{await this.readTask;}catch{}try{this.reader.releaseLock();}catch{}try{this.writer.releaseLock();}catch{}}
}
// Select BOOT/RESET wiring based on the selected interface.
function selectedUsbMethod(){
 const selected=$('resetMethod').value;
 const info=port.getInfo?port.getInfo():{};
 return selected==='auto'?(info.usbVendorId===0x303a?'native':'uart'):selected;
}
// Web Serial native USB-JTAG sequence follows Espressif USB-Serial/JTAG TRM.
// Windows usbser.sys sometimes propagates DTR only on an RTS write.
// Use one control-line update per step, never assume DTR/RTS behave like physical buttons.
async function setLines(dtr,rts,phase){
 try{await port.setSignals({dataTerminalReady:dtr,requestToSend:rts});}
 catch(e){throw Error(`${phase}: ${e.message}`);}
}
async function bootMode(){
 const method=selectedUsbMethod();
 log(`AUTO BOOT: ${method} / USB VID=${hex((port.getInfo?.().usbVendorId)||0)}`);
 if(method==='native'){
  // TRM: D0, R0, D1, R0, R1, D0, R1, R0.
  // Hold the download request 2 seconds BEFORE completing reset; after the
  // reset the USB-JTAG peripheral requires DTR deasserted to latch reset.
  await setLines(false,false,'native idle');await sleep(100);
  await setLines(true,false,'native BOOT request');
  await setLines(true,false,'native propagate BOOT via RTS');
  log('AUTO BOOT: ค้างสัญญาณขอเข้า Download Mode 2 วินาที');
  await sleep(2000);
  await setLines(true,true,'native reset pulse');await sleep(100);
  await setLines(false,true,'native reset latch');
  await setLines(false,true,'native propagate DTR via RTS');await sleep(100);
  await setLines(false,false,'native release reset');
 }else{
  // Classic ESP32 USB-UART transistor circuit, standard esptool order.
  await setLines(false,false,'uart idle');await sleep(100);
  await setLines(false,true,'uart reset assert');await sleep(100);
  await setLines(true,false,'uart release reset with BOOT held');
  log('AUTO BOOT: ค้าง BOOT 2 วินาทีหลังปล่อย RESET (USB-UART)');
  await sleep(2000);
  await setLines(false,false,'uart release BOOT');
 }
 await sleep(150);
 log('AUTO BOOT: ส่งลำดับสัญญาณครบแล้ว เริ่ม ROM SYNC');
}
async function resetRun(){
 const method=selectedUsbMethod();
 log(`AUTO RESET: ${method}`);
 // C3 native USB-JTAG TRM hard reset: D0, R0, R1, R0.
 // Same physical RTS pulse works on conventional USB-UART auto-reset circuits.
 await setLines(false,false,'reset idle');await sleep(100);
 await setLines(false,true,'reset assert RTS');await sleep(120);
 await setLines(false,false,'reset release RTS');await sleep(250);
 log('AUTO RESET: ส่ง RTS pulse แล้ว (ยังไม่ยืนยันการบูตจาก Flash)');
}
$('connect').onclick=async()=>{try{port=await navigator.serial.requestPort();await port.open({baudRate:Number($('baud').value),bufferSize:16384});$('portInfo').textContent='COM Port เปิดแล้ว';log('เปิด COM Port สำเร็จ (ยังไม่ได้สั่งแฟลช)');update();}catch(e){log('ERROR เชื่อมต่อ COM Port: '+e.message);if(port){try{await port.close();}catch{}}port=null;update();}};
$('disconnect').onclick=async()=>{try{await port.close();log('ตัดการเชื่อมต่อแล้ว');}catch(e){log('ERROR: '+e.message);}port=null;$('portInfo').textContent='ยังไม่เชื่อมต่อ';update();};
$('cancel').onclick=()=>{cancelRequested=true;log('กำลังขอหยุดหลังบล็อกปัจจุบัน');};
$('clear').onclick=()=>{$('log').textContent='';};
$('flash').onclick=async()=>{
 if(!port||!firmware)return;
 if(!confirm(`เฉพาะ ESP32-C3 เท่านั้น!\nยืนยันแฟลช ${firmware.length.toLocaleString()} bytes ที่ 0x0000 ?\nไม่ใช้ Erase All; เฉพาะช่วงที่เขียนจะถูกลบตามคำสั่ง Flash Begin`))return;
 active=true;cancelRequested=false;update();$('progress').value=0;$('pct').textContent='0%';
 let writeComplete=false,verified=false,verifyFailed=false;
 try{
  log('เริ่มเข้า ESP32 ROM Download Mode...');await bootMode();rom=new ROM(port);await rom.start();await rom.sync();
  log('ROM ตอบสนองแล้ว (ยังไม่ได้ตรวจสอบ Chip ID: ต้องยืนยันว่าเป็น ESP32-C3)');
  await rom.attach();log('SPI Flash attached');
  log(`เขียน ${firmware.length.toLocaleString()} bytes ที่ 0x0000 (ROM uncompressed)`);
  await rom.writeFlash(firmware,p=>{$('progress').value=p;$('pct').textContent=p+'%';});
  writeComplete=true;
  log('WRITE COMPLETE: ROM ตอบรับการเขียนครบทุกบล็อก (ยังไม่ยืนยันข้อมูลที่อ่านกลับ)');
  log('ทดลองตรวจสอบ Flash MD5 (หาก ROM ไม่รองรับ จะไม่ขัดขวางการ RESET)...');
  try{
   await rom.verifyFlash(firmware);verified=true;
  }catch(e){
   if(/VERIFY FAILED|MD5 รูปแบบไม่ถูกต้อง/.test(e.message)){
    verifyFailed=true;log('VERIFY FAILED: '+e.message);
   }else{
    log('VERIFY UNAVAILABLE: '+e.message);
    log('ไม่สามารถยืนยัน MD5 ได้ แต่ ROM ตอบรับการเขียนครบทุกบล็อก');
   }
  }
 }catch(e){
  log('ERROR ระหว่างเขียน Flash: '+e.message);
  log('หากเข้าโหมดดาวน์โหลดไม่ได้ ให้กด BOOT ค้างแล้วกด EN/RESET หนึ่งครั้ง ก่อนทดลองใหม่');
 }finally{
  if(rom){try{await rom.stop();}catch(e){log('ปิด ROM Serial: '+e.message);}rom=null;}
  // A verification timeout must not prevent reset after a completed write.
  if(writeComplete){
   try{await resetRun();log('ส่งคำสั่ง RESET แล้ว (ยังไม่ยืนยันว่าบอร์ดรีบูตจริง)');}
   catch(e){log('RESET อัตโนมัติไม่สำเร็จ: '+e.message+'; กรุณากด EN/RESET บนบอร์ด');}
   if(verified)log('เสร็จสิ้น: WRITE COMPLETE + VERIFY PASS');
   else if(verifyFailed)log('คำเตือน: เขียนครบแต่ VERIFY FAILED — ห้ามถือว่าแฟลชสำเร็จ');
   else log('เสร็จสิ้น: WRITE COMPLETE / VERIFY NOT CONFIRMED — ตรวจสอบว่าบอร์ดบูตได้');
  }
  active=false;update();
 }
};
update();
