const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ecApi', {
  requestExit: (text) => ipcRenderer.invoke('ec-request-exit', text),
  selectMonitor: (monitor) => ipcRenderer.send('ec-select-monitor', monitor),
  onOpenNewTab: (callback) => {
    console.log('[preload] 注册 ec-open-new-tab 监听器');
    const handler = (_event, url) => {
      console.log('[preload] 收到 ec-open-new-tab:', url);
      callback(url);
    };
    ipcRenderer.on('ec-open-new-tab', handler);
    return () => ipcRenderer.removeListener('ec-open-new-tab', handler);
  }
});

// 应用启动时立即通知主进程
ipcRenderer.send('ec-renderer-ready');