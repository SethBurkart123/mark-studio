'use strict';
const assert=require('node:assert/strict');
const {DEFAULTS,validateSettings,validateJob,encode,makeRecord,Engraver}=require('./protocol');
const settings={...DEFAULTS,reverseX:false};
const job={width:65,height:50,originX:0,originY:0,speed:50,strokes:[[[5,25],[6,25]],[[9,25],[10,25]]]};
assert.equal(makeRecord(0x80,[32,0,0]).toString('hex'),'80200000000000000000');
const start=[Math.round(5/settings.stepX),Math.round(25/settings.stepY),0];
const dry=encode(job,settings,start,false),wet=encode(job,settings,start,true);
assert.equal(dry.payload.length%800,0);assert.equal(wet.payload[0],0x80);assert.equal(wet.payload[10],0);
for(let i=0;i<dry.records;i++)assert.equal(dry.payload[i*10],0x80);
assert(wet.payload.subarray(wet.records*10).every(v=>v===255));
assert.equal(wet.payload[(wet.records-1)*10],0x80);
const mirrored=encode(job,{...settings,reverseX:true},[Math.round(60/settings.stepX),start[1],0],true);
assert.equal(mirrored.payload.readUIntLE(1,3),Math.round(60/settings.stepX));
assert.equal(mirrored.target[0],Math.round(55/settings.stepX));
for(const bad of [NaN,Infinity,-1,10000])assert.throws(()=>validateJob({...job,width:bad},settings));
assert.throws(()=>validateJob({...job,strokes:[[[0,0],[66,2]]]},settings));
assert.throws(()=>validateSettings({...settings,stepX:0}));
assert.throws(()=>encode(job,settings,[0,0,1],true));
// A small controller simulator checks packet flow, partial serial reads, stop and timeouts.
class FakeMachine extends Engraver{
 constructor(){super();this.homed=true;this.current=[0,0,0];this.sent=[];this.port={isOpen:true};this.blocks=0;}
 async close(){this.port=null;this.homed=false;}
 feed(b){this.buffer=Buffer.concat([this.buffer,Buffer.from(b)]);this.waiter?.();}
 async write(input){const b=Buffer.from(input);this.sent.push(b);if(b.length===800){for(let i=0;i<800;i+=10){if(b[i]===255)break;this.current=[1,4,7].map(o=>b.readUIntLE(i+o,3));}this.feed([0x60]);if(--this.blocks===0)this.feed([0x6a]);}else if(b[0]===0x16){const reply=Buffer.concat([Buffer.from([0x16]),makeRecord(0,this.current).subarray(1)]);setTimeout(()=>this.feed(reply.subarray(0,3)),1);setTimeout(()=>this.feed(reply.subarray(3)),3);}else if(b[0]===0x60){this.blocks=b.readUInt16LE(1);this.feed([0x60]);}else if(b[0]===0x22){this.current=[1,4,7].map(o=>b.readUIntLE(o,3));this.feed([0x22,0]);}else if(b[0]===0x21){this.current=[0,0,0];this.feed([0x21,0]);}else if([0x30,0x31,0x20].includes(b[0]))this.feed([b[0]]);else if(b[0]===0xaf)this.feed([0x65]);}
}
(async()=>{const m=new FakeMachine();await m.home();assert(m.homed);await m.run(job,settings,false);assert.deepEqual(m.xyz,dry.target);await m.run(job,settings,true);assert.deepEqual(m.xyz,wet.target);await assert.rejects(()=>m.read(1,10),/timed out/);
 const boundary=new FakeMachine();
 await assert.rejects(()=>boundary.jog(0,-1,settings),/travel limit/);
 assert(boundary.homed && boundary.port.isOpen && !boundary.busy);
 assert.deepEqual(boundary.sent.map(packet=>packet[0]),[0x16]);
 const absolute=new FakeMachine();
 await absolute.move(20,30,settings);
 assert.deepEqual(absolute.xyz,[Math.round(20/settings.stepX),Math.round(30/settings.stepY),0]);
 assert.deepEqual(absolute.sent.map(packet=>packet[0]),[0x16,0x22,0x16]);
 await assert.rejects(()=>absolute.move(-1,0,settings));
 assert(absolute.homed && absolute.port.isOpen);
 const stopping=new FakeMachine();stopping.busy=true;await stopping.stop();assert(stopping.stopping);assert(!stopping.homed);assert.equal(stopping.sent[0][0],0xaf);
 console.log('PASS: bounds, packet parity, pin-up travel, mirror correction, complete job exchange, partial reads, timeout and stop.');
 if(process.argv.includes('--device')){const {SerialPort}=require('serialport');const ports=await SerialPort.list();const p=ports.find(p=>p.vendorId?.toLowerCase()==='0403'&&p.productId?.toLowerCase()==='6015');assert(p,'Compatible FTDI engraver not connected');const real=new Engraver();try{console.log(await real.connect(p.path));}finally{await real.close();}console.log('PASS: live identification and position query only; no movement or marking.');}
})().catch(e=>{console.error(e);process.exitCode=1;});
