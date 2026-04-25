const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ecApi', {
  requestExit: (text) => ipcRenderer.invoke('ec-request-exit', text),
  selectMonitor: (data) => ipcRenderer.invoke('ec-select-monitor', data),
  openMainWindow: (examUrl) => ipcRenderer.invoke('ec-open-main-window', examUrl),
  onOpenNewTab: (callback) => {
    console.log('[preload] 注册 ec-open-new-tab 监听器');
    const handler = (_event, url) => {
      console.log('[preload] 收到 ec-open-new-tab:', url);
      callback(url);
    };
    ipcRenderer.on('ec-open-new-tab', handler);
    return () => ipcRenderer.removeListener('ec-open-new-tab', handler);
  },
  onStartExam: (callback) => {
    console.log('[preload] 注册 ec-start-exam 监听器');
    const handler = (_event, url) => {
      console.log('[preload] 收到 ec-start-exam:', url);
      callback(url);
    };
    ipcRenderer.on('ec-start-exam', handler);
    return () => ipcRenderer.removeListener('ec-start-exam', handler);
  },
  onSetWatermark: (callback) => {
    console.log('[preload] 注册 ec-set-watermark 监听器');
    const handler = (_event, userInfo) => {
      console.log('[preload] 收到 ec-set-watermark:', userInfo);
      callback(userInfo);
    };
    ipcRenderer.on('ec-set-watermark', handler);
    return () => ipcRenderer.removeListener('ec-set-watermark', handler);
  },
  onTriggerExitModal: (callback) => {
    console.log('[preload] 注册 ec-trigger-exit-modal 监听器');
    const handler = (_event) => {
      console.log('[preload] 收到 ec-trigger-exit-modal');
      callback();
    };
    ipcRenderer.on('ec-trigger-exit-modal', handler);
    return () => ipcRenderer.removeListener('ec-trigger-exit-modal', handler);
  },
  onPauseExam: (callback) => {
    console.log('[preload] 注册 ec-pause-exam 监听器');
    const handler = (_event) => {
      console.log('[preload] 收到 ec-pause-exam');
      callback();
    };
    ipcRenderer.on('ec-pause-exam', handler);
    return () => ipcRenderer.removeListener('ec-pause-exam', handler);
  },
  onResumeExam: (callback) => {
    console.log('[preload] 注册 ec-resume-exam 监听器');
    const handler = (_event) => {
      console.log('[preload] 收到 ec-resume-exam');
      callback();
    };
    ipcRenderer.on('ec-resume-exam', handler);
    return () => ipcRenderer.removeListener('ec-resume-exam', handler);
  }
});

// 应用启动时立即通知主进程
ipcRenderer.send('ec-renderer-ready');