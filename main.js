'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { SerialPort } = require('serialport');
const { Engraver, DEFAULTS, validateSettings, validateJob } = require('./protocol');
app.setPath('userData', path.join(app.getPath('appData'), 'Peen Studio'));
const machine = new Engraver();
let startPressed = null, releasedSince = null, connecting = false;
const buttonTimer = setInterval(async () => {
  if (connecting || !machine.port?.isOpen || machine.busy) { startPressed = null; releasedSince = null; return; }
  try {
    const pressed = await machine.startButton();
    if (pressed === null) return;
    if (!pressed) {
      releasedSince ??= Date.now();
      if (Date.now() - releasedSince >= 750) startPressed = false;
      return;
    }
    releasedSince = null;
    const freshPress = startPressed === false;
    startPressed = true;
    if (freshPress) notify('start');
  } catch (e) {
    startPressed = null;
    await machine.close();
    notify('log', e.message);
  }
}, 250);
buttonTimer.unref();
let window, settings = {...DEFAULTS}, previewHash = null, quitting = false;
const fingerprint = job => crypto.createHash('sha256').update(JSON.stringify({job,settings})).digest('hex');
const notify = (type,data) => { if (window && !window.isDestroyed()) window.webContents.send('update',{type,data}); };
machine.on('state', data => { if (data.busy || !data.homed) { startPressed = null; releasedSince = null; } if (!data.connected || !data.homed) previewHash = null; notify('state',data); });
machine.on('log', data => notify('log',data));
machine.on('progress', data => notify('progress',data));
function handle(name, callback) { ipcMain.handle(name, async (event,...args) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window.');
  try { if (machine.statusRead) await machine.statusRead; return {ok:true,value:await callback(...args)}; } catch (e) { notify('log',e.message); return {ok:false,error:e.message}; }
}); }
handle('initial', async () => ({settings,state:machine.state(),version:app.getVersion()}));
handle('ports', async () => (await SerialPort.list()).map(p => ({path:p.path,name:p.friendlyName || p.manufacturer || 'Serial device',recommended:p.vendorId?.toLowerCase()==='0403' && p.productId?.toLowerCase()==='6015'})));
handle('connect', async p => {
  if (connecting) throw new Error('Connection already in progress.');
  connecting=true;
  try { return await machine.connect(p); } finally { connecting=false; }
});
handle('disconnect', async () => { if (machine.busy) throw new Error('Stop the current job first.'); await machine.close(); });
handle('home', async () => { previewHash=null; await machine.home(); });
handle('jog', async (dx,dy) => { previewHash=null; await machine.jog(dx,dy,settings); });
handle('move', async (x,y) => { previewHash=null; await machine.move(x,y,settings); });
handle('capture', async () => {
  if (!machine.homed) throw new Error('Home before setting corners.');
  previewHash=null;
  return machine.action(async () => { const xyz=await machine.position(); return [xyz[0]*settings.stepX,xyz[1]*settings.stepY]; });
});
handle('stop', async () => { previewHash=null; await machine.stop(); });
handle('settings', async value => {
  if (machine.busy) throw new Error('Wait for the machine to stop.');
  settings = validateSettings(value); machine.homed=false; machine.update(); previewHash=null;
  await fs.writeFile(path.join(app.getPath('userData'),'settings.json'),JSON.stringify(settings,null,2)); return settings;
});
handle('run', async (job,mode) => {
  if (!['outline','workpiece','dry-run','engrave'].includes(mode)) throw new Error('Choose outline, dry run or engrave.');
  const mark=mode==='engrave';
  if(mode==='workpiece'){
    const {width:w,height:h}=job;
    job={...job,strokes:[[[0,h],[w,h],[w,0],[0,0],[0,h]]]};
  }
  validateJob(job,settings); const hash=fingerprint(job);
  if (mark && hash!==previewHash) throw new Error('Preview this exact layout before engraving.');
  previewHash=null;
  let movement=job;
  if (mode==='outline') {
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for (const stroke of job.strokes) for (const [x,y] of stroke) { left=Math.min(left,x); right=Math.max(right,x); bottom=Math.min(bottom,y); top=Math.max(top,y); }
    movement={...job,strokes:[[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]]]};
  }
  await machine.run(movement,settings,mark);
  previewHash=mode==='workpiece'?null:hash;
});
handle('import', async () => {
  const result=await dialog.showOpenDialog(window,{title:'Import artwork',properties:['openFile'],filters:[{name:'Artwork',extensions:['svg','png','jpg','jpeg','webp','peen']}]});
  if(result.canceled)return null;
  const file=result.filePaths[0]; const stat=await fs.stat(file);
  if(stat.size>8*1024*1024)throw new Error('Choose a file smaller than 8 MB.');
  return {name:path.basename(file),data:(await fs.readFile(file)).toString('base64')};
});
handle('save', async document => {
  if(typeof document!=='string'||document.length>8*1024*1024)throw new Error('Project is too large.');
  JSON.parse(document);
  const result=await dialog.showSaveDialog(window,{title:'Save project',defaultPath:'Untitled.peen',filters:[{name:'Mark Studio project',extensions:['peen']}]});
  if(!result.canceled)await fs.writeFile(result.filePath,document);
  return !result.canceled;
});
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{window?.show();window?.focus();});
app.whenReady().then(async()=>{
  try {settings=validateSettings(JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8')));}catch{}
  window=new BrowserWindow({width:1320,height:850,minWidth:1100,minHeight:730,title:'Mark Studio',backgroundColor:'#f6f5f1',titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:22},webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'Mark Studio',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'quit'}]}]:[]),
    {label:'File',submenu:[{label:'Import artwork…',accelerator:'CmdOrCtrl+O',click:()=>notify('command','import')},{label:'Save project…',accelerator:'CmdOrCtrl+S',click:()=>notify('command','save')},{type:'separator'},{role:process.platform==='darwin'?'close':'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
  ]));
  await window.loadFile('index.html');
  window.on('close',event=>{
    if(machine.busy&&!quitting){event.preventDefault();dialog.showMessageBox(window,{type:'warning',message:'The engraver is still running.',detail:'Stop the machine before closing Mark Studio.',buttons:['Keep open','Stop machine']}).then(r=>{if(r.response===1)void machine.stop();});}
  });
});
app.on('window-all-closed',()=>{clearInterval(buttonTimer);quitting=true;void machine.close().finally(()=>app.quit());});
