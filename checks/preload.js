const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('testResult',r=>ipcRenderer.send('result',r));
