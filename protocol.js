'use strict';
const { EventEmitter } = require('node:events');
const { SerialPort } = require('serialport');

const DEFAULTS = Object.freeze({ bedWidth: 140, bedHeight: 80, stepX: 0.0069851349, stepY: 0.0069851349, reverseX: true });
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function validateSettings(s) {
  return { bedWidth: finite(s.bedWidth, 10, 1000, 'X travel'), bedHeight: finite(s.bedHeight, 10, 1000, 'Y travel'),
    stepX: finite(s.stepX, 0.0001, 1, 'X calibration'), stepY: finite(s.stepY, 0.0001, 1, 'Y calibration'), reverseX: s.reverseX === true };
}
function validateJob(job, settings) {
  finite(job.width, 1, settings.bedWidth, 'Workpiece width'); finite(job.height, 1, settings.bedHeight, 'Workpiece height');
  if (job.corners) {
    if (!Array.isArray(job.corners) || job.corners.length !== 2) throw new Error('Set both workpiece corners.');
    for (const point of job.corners) {
      if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid corner.');
      finite(point[0], 0, settings.bedWidth, 'Corner X'); finite(point[1], 0, settings.bedHeight, 'Corner Y');
    }
    if (Math.abs(Math.abs(job.corners[1][0]-job.corners[0][0])-job.width)>0.001 || Math.abs(Math.abs(job.corners[1][1]-job.corners[0][1])-job.height)>0.001) throw new Error('Workpiece dimensions changed. Set both corners again.');
  }
  finite(job.originX, 0, settings.bedWidth - job.width + 1e-9, 'Workpiece X'); finite(job.originY, 0, settings.bedHeight - job.height + 1e-9, 'Workpiece Y');
  finite(job.speed, 1, 100, 'Marking speed');
  if (!Array.isArray(job.strokes) || !job.strokes.length || job.strokes.length > 20000) throw new Error('Import artwork with visible lines first.');
  let count = 0;
  for (const stroke of job.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) throw new Error('Artwork contains an incomplete line.');
    count += stroke.length;
    if (count > 100000) throw new Error('Artwork is too detailed. Simplify it to fewer than 100,000 points.');
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid artwork point.');
      finite(point[0], 0, job.width, 'Artwork X'); finite(point[1], 0, job.height, 'Artwork Y');
    }
  }
}
function makeRecord(flag, point) {
  const b = Buffer.alloc(10); b[0] = flag;
  point.forEach((v, i) => { if (!Number.isInteger(v) || v < 0 || v > 0xffffff) throw new Error('Invalid step coordinate.'); b.writeUIntLE(v, 1 + i * 3, 3); });
  return b;
}
function encode(job, settings, start, mark) {
  validateJob(job, settings);
  if (start[2] !== 0) throw new Error('Rotary/Z mode is not supported. Set up the flat XY machine first.');
  const records = []; let current = start;
  for (const stroke of job.strokes) {
    stroke.forEach(([x, y], index) => {
      const target = job.corners ? [Math.round((job.corners[0][0] + x * Math.sign(job.corners[1][0]-job.corners[0][0])) / settings.stepX), Math.round((job.corners[0][1] + (job.height-y) * Math.sign(job.corners[1][1]-job.corners[0][1])) / settings.stepY), 0] : [Math.round((job.originX + (settings.reverseX ? job.width - x : x)) / settings.stepX), Math.round((job.originY + y) / settings.stepY), 0];
      const flag = mark && index > 0 ? 0 : 0x80;
      const segments = Math.floor(Math.hypot(...target.map((v, i) => v - current[i])) / 300) + 1;
      if (records.length + segments > 200000) throw new Error('This job is too large. Reduce artwork detail or size.');
      for (let s = 1; s < segments; s++) records.push(makeRecord(flag, current.map((v, i) => v + Math.trunc((target[i] - v) / segments) * s)));
      records.push(makeRecord(flag, target)); current = target;
    });
  }
  records.push(makeRecord(0x80, current));
  const body = Buffer.concat(records);
  return { payload: Buffer.concat([body, Buffer.alloc(800 - body.length % 800, 0xff)]), target: current, records: records.length };
}

class Engraver extends EventEmitter {
  constructor() { super(); this.port = null; this.buffer = Buffer.alloc(0); this.waiter = null; this.busy = false; this.homed = false; this.stopping = false; this.xyz = null; this.version = ''; }
  state() { return { connected: !!this.port?.isOpen, port: this.port?.path, busy: this.busy, homed: this.homed, xyz: this.xyz, version: this.version, stopping: this.stopping }; }
  update() { this.emit('state', this.state()); }
  log(message) { this.emit('log', message); }
  async read(n, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (this.buffer.length < n) {
      if (!this.port?.isOpen) throw new Error('USB connection lost. Reconnect and home the machine.');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('The controller did not respond. Check its power and physical STOP button.');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.waiter = null; reject(new Error('Controller response timed out.')); }, remaining);
        this.waiter = error => { clearTimeout(timer); this.waiter = null; error ? reject(error) : resolve(); };
      });
    }
    const result = this.buffer.subarray(0, n); this.buffer = this.buffer.subarray(n); return result;
  }
  async write(bytes) {
    if (!this.port?.isOpen) throw new Error('Connect the engraver first.');
    await new Promise((resolve, reject) => this.port.write(Buffer.from(bytes), e => e ? reject(e) : this.port.drain(e => e ? reject(e) : resolve())));
  }
  async exchange(bytes, expected) {
    await this.write(bytes); const reply = await this.read(expected.length);
    if (!reply.equals(Buffer.from(expected))) throw new Error(`Unexpected controller response (${reply.toString('hex')}). Reconnect before trying again.`);
  }
  async position() {
    await this.write([0x16]); const p = await this.read(10);
    if (p[0] !== 0x16) throw new Error('Invalid position response.');
    this.xyz = [1, 4, 7].map(i => p.readUIntLE(i, 3)); this.update(); return this.xyz;
  }
  async connect(path) {
    if (this.busy) throw new Error('Wait for the current operation.');
    await this.close(); this.buffer = Buffer.alloc(0); this.homed = false;
    const available = await SerialPort.list();
    if (!available.some(p => p.path === path)) throw new Error('That USB device is no longer connected.');
    this.port = new SerialPort({ path, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false, lock: true });
    this.port.on('data', data => { this.buffer = Buffer.concat([this.buffer, data]); if (this.buffer.length > 1048576) { this.waiter?.(new Error('Unexpected USB data.')); void this.close(); } else this.waiter?.(); });
    this.port.on('error', e => { this.log(`USB: ${e.message}`); this.waiter?.(e); });
    this.port.on('close', () => { this.homed = false; this.waiter?.(new Error('USB disconnected.')); this.update(); });
    try {
      await new Promise((resolve, reject) => this.port.open(e => e ? reject(e) : resolve()));
      await new Promise((resolve, reject) => this.port.flush(e => e ? reject(e) : resolve()));
      await this.exchange([0], [0]); await this.write([255, 1, 2]); const id = await this.read(10);
      if (id[0] !== 255 || ![3,17,2,23,7,11,5,13,19].every((d, i) => id[i+1] > 0 && id[i+1] % d === 0)) throw new Error('This device is not a compatible ThorX6 engraver.');
      await this.write([0x10]); const version = await this.read(10);
      if (version[0] !== 0x10) throw new Error('Controller version could not be read.');
      this.version = version.subarray(1).toString('ascii').replace(/\0/g, '');
      await this.position(); this.log(`Connected to ${this.version}. No movement sent.`); this.update(); return this.state();
    } catch (e) { await this.close(); throw new Error(`${e.message} Close ThorX6 or any other app using the USB port.`); }
  }
  async close() {
    const port = this.port;
    this.homed = false; this.port = null;
    this.waiter?.(new Error('Connection closed.'));
    if (port?.isOpen) await new Promise(resolve => port.close(() => resolve()));
    this.update();
  }
  async startButton() {
    if (this.busy || this.statusRead || !this.port?.isOpen) return null;
    this.statusRead = (async () => {
      await this.write([0x11]);
      const reply = await this.read(2);
      if (reply[0] !== 0x11) throw new Error('Invalid button status response.');
      return (reply[1] & 0x10) === 0;
    })();
    try { return await this.statusRead; } finally { this.statusRead = null; }
  }
  async action(operation) {
    if (this.statusRead) await this.statusRead;
    if (this.busy) throw new Error('The machine is already busy.');
    if (!this.port?.isOpen) throw new Error('Connect the engraver first.');
    this.busy = true; this.stopping = false; this.update();
    try { return await operation(); }
    catch (e) { this.homed = false; if (this.port?.isOpen) await this.write([0xaf]).catch(() => {}); await this.close(); throw e; }
    finally { this.busy = false; this.stopping = false; this.update(); }
  }
  async home() {
    return this.action(async () => {
      this.homed = false; this.log('Homing X and Y…'); await this.write([0x21, 0x50]);
      const reply = await this.read(2, 120000);
      if (!reply.equals(Buffer.from([0x21, 0])) || this.stopping) throw new Error('Homing stopped or did not complete.');
      const xyz = await this.position(); if (xyz[0] || xyz[1]) throw new Error('Homing returned a nonzero position.');
      this.homed = true; this.log('Home complete. X 0 · Y 0');
    });
  }
  async jog(dx, dy, settings) {
    finite(dx, -10, 10, 'X jog'); finite(dy, -10, 10, 'Y jog');
    return this.move(dx, dy, settings, true);
  }
  async move(x, y, settings, relative = false) {
    finite(x, relative ? -10 : 0, relative ? 10 : settings.bedWidth, 'X position');
    finite(y, relative ? -10 : 0, relative ? 10 : settings.bedHeight, 'Y position');
    if (!this.homed) throw new Error('Home the machine before moving it.');
    const rejected = await this.action(async () => {
      const start = await this.position();
      const target = [Math.round(x / settings.stepX), Math.round(y / settings.stepY), start[2]];
      if (relative) { target[0] += start[0]; target[1] += start[1]; }
      for (const [axis, step, limit] of [[0, settings.stepX, settings.bedWidth], [1, settings.stepY, settings.bedHeight]]) {
        if (target[axis] < 0 || target[axis] > Math.floor(limit / step)) return `${axis === 0 ? 'X' : 'Y'} travel limit reached. Choose another position or a smaller jog distance.`;
      }
      const packet = Buffer.alloc(12); packet[0] = 0x22;
      target.forEach((value, axis) => packet.writeUIntLE(value, 1 + axis * 3, 3));
      packet.writeUInt16LE(980, 10);
      await this.write(packet); const reply = await this.read(2, 120000);
      if (!reply.equals(Buffer.from([0x22, 0])) || this.stopping) throw new Error('Movement stopped.');
      const actual = await this.position();
      if (actual.some((value, axis) => value !== target[axis])) throw new Error('Position mismatch. Home again.');
    });
    if (rejected) throw new Error(rejected);
  }
  async stop() {
    if (!this.busy || !this.port?.isOpen) return;
    this.stopping = true; this.homed = false; this.log('Stop requested. Use the physical STOP button if motion continues.'); this.update();
    await this.write([0xaf]);
  }
  async run(job, settings, mark) {
    return this.action(async () => {
      if (!this.homed) throw new Error('Home the machine first.');
      const start = await this.position(); const {payload, target} = encode(job, settings, start, mark);
      const count = payload.length / 800;
      this.log(mark ? 'Engraving one pass…' : 'Previewing with the marking pin inactive…');
      const speed = Buffer.alloc(7); speed[0] = 0x30; [1030-job.speed*10,980,230].forEach((v,i) => speed.writeUInt16LE(v,1+i*2));
      await this.exchange(speed,[0x30]); await this.exchange([0x31,20,20],[0x31]); await this.exchange([0x20,0x80],[0x20]);
      const header = Buffer.from([0x60,count&255,count>>8]); await this.exchange(header,[0x60]);
      let completed = 0;
      const event = async expected => {
        const deadline = Date.now()+120000;
        while (Date.now()<deadline) {
          const b = (await this.read(1,Math.max(1,deadline-Date.now())))[0];
          if (this.stopping || b === 0x62 || b === 0x65) throw new Error('Stopped. Home before the next job.');
          if (b === 0x6f) { completed++; this.emit('progress', { value: Math.min(98,Math.round(completed / (payload.length/10)*100)), label: mark ? 'Engraving' : 'Previewing' }); continue; }
          if (b !== expected) throw new Error(`Unexpected job response (${b.toString(16)}).`);
          return;
        }
        throw new Error('Controller exceeded the job timeout.');
      };
      for (let i=0; i<count; i++) { if (this.stopping) throw new Error('Stopped.'); await this.write(payload.subarray(i*800,(i+1)*800)); await event(0x60); }
      await event(0x6a); await this.exchange([0x20,0x80],[0x20]); await this.exchange([0x20,0xc0],[0x20]);
      const actual = await this.position(); if (actual.some((v,i) => v!==target[i])) throw new Error('Final position does not match. Home before continuing.');
      this.emit('progress',{value:100,label:'Complete'}); this.log(mark ? 'Marking pass complete. Inspect the workpiece.' : 'Preview complete. Ready to engrave.');
    });
  }
}
module.exports = { DEFAULTS, finite, validateSettings, validateJob, makeRecord, encode, Engraver };
