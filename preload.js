const { contextBridge, ipcRenderer } = require('electron');
const methods = ['initial','ports','connect','disconnect','home','move','capture','jog','stop','settings','run','import','save'];
const api = Object.fromEntries(methods.map(name=>[name,async(...args)=>{
  const result=await ipcRenderer.invoke(name,...args); if(!result.ok)throw new Error(result.error); return result.value;
}]));
api.onUpdate=callback=>ipcRenderer.on('update',(_event,message)=>callback(message));
contextBridge.exposeInMainWorld('peen',api);
