const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer } = require('electron');
const { exec } = require('child_process');
const axios = require('axios');
const screenshot = require('desktop-screenshot');
const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('./config');

// 隐藏退出快捷键（仅你知道）
const SAFE_QUIT_ACCELERATOR = config.EXIT.SAFE_QUIT_ACCELERATOR;
const EXIT_CONFIRM_TEXT = config.EXIT.CONFIRM_TEXT;

// 默认尝试关闭的通讯软件
const BLOCKED_PROCESS_NAMES = config.BLOCKED_PROCESSES;

let mainWindow = null;
let loginWindow = null;
let isAppQuittingAllowed = false;
let isRendererReady = false;
let pendingNewTabUrls = [];
let monitorIP = null;
let clientId = null;
let screenshotInterval = null;
let currentUserInfo = null;
let heartbeatInterval = null;
let reconnectInterval = null;
let isMonitoringConnected = true;
let originalServerUrl = null;
let selectedMonitorId = null;

function killBlockedProcessesOnWindows() {
  if (process.platform !== 'win32') return;
  BLOCKED_PROCESS_NAMES.forEach((processName) => {
    const cmd = `taskkill /F /T /IM "${processName}"`;
    exec(cmd, (error) => {
      if (!error) console.log(`[KILLED] ${processName}`);
    });
  });
}

// 获取客户端ID
function getClientId() {
  return os.hostname() + '-' + Date.now();
}

// 连接到监控服务器
async function connectToMonitor(selectedMonitor = null, userInfo = null) {
  try {
    let monitors;

    if (selectedMonitor) {
      monitors = [selectedMonitor];
    } else {
      // 从Web端获取监控服务器列表
      const response = await axios.get(`${config.MONITOR_API.BASE_URL}${config.MONITOR_API.ENDPOINTS.GET_MONITORS}`);
      monitors = response.data;

      if (monitors.length === 0) {
        console.log('No monitors available');
        return;
      }

      // 优先选择有公网穿透地址的监控服务器
      const monitorWithPublicUrl = monitors.find(m => m.public_url && m.public_url.trim() !== '');
      selectedMonitor = monitorWithPublicUrl || monitors[0];
    }

    // 保存选中的监控服务器ID
    selectedMonitorId = selectedMonitor.id;
    clientId = userInfo ? userInfo.studentId : getClientId();

    // 尝试连接：优先使用 public_url，失败则降级到 ip:port
    let connected = false;
    let serverUrl = null;

    // 第一次尝试：使用 public_url
    if (selectedMonitor.public_url && selectedMonitor.public_url.trim() !== '') {
      try {
        serverUrl = selectedMonitor.public_url;
        monitorIP = selectedMonitor.public_url;
        console.log(`Trying public URL: ${serverUrl}`);
        
        await axios.post(`${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.CONNECT}`, {
          clientId,
          name: userInfo?.name || '',
          nickname: userInfo?.nickname || ''
        });
        
        connected = true;
        console.log(`Connected via public URL as ${clientId}`);
      } catch (error) {
        console.warn(`Public URL connection failed (${error.response?.status || error.message}), falling back to IP...`);
      }
    }

    // 第二次尝试：使用 ip:port
    if (!connected) {
      serverUrl = `http://${selectedMonitor.ip}:${config.MONITOR_SERVER.DEFAULT_PORT}`;
      monitorIP = selectedMonitor.ip;
      console.log(`Trying IP: ${serverUrl}`);
      
      await axios.post(`${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.CONNECT}`, {
        clientId,
        name: userInfo?.name || '',
        nickname: userInfo?.nickname || ''
      });
      
      connected = true;
      console.log(`Connected via IP as ${clientId}`);
    }

    if (!connected) {
      throw new Error('All connection attempts failed');
    }

    originalServerUrl = serverUrl;

    // 启动心跳
    startHeartbeat(serverUrl);

    // 启动屏幕截图
    startScreenshotCapture(serverUrl);

  } catch (error) {
    console.error('Failed to connect to monitor:', error.message);
  }
}

// 启动心跳检测
function startHeartbeat(serverUrl) {
  // 清除旧的心跳定时器
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(async () => {
    try {
      await axios.post(`${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.HEARTBEAT}`, { clientId });
      
      // 心跳成功，如果之前断开了现在恢复
      if (!isMonitoringConnected) {
        console.log('[RECONNECT] Monitor connection restored!');
        isMonitoringConnected = true;
        stopReconnectAttempt();
        resumeExam();
      }
    } catch (error) {
      console.error('Heartbeat failed:', error.message);
      
      // 心跳失败，开始重连流程
      if (isMonitoringConnected) {
        console.log('[DISCONNECTED] Monitor connection lost, attempting reconnect...');
        isMonitoringConnected = false;
        pauseExam();
        startReconnectAttempt();
      }
    }
  }, 10000);
}

// 开始重连尝试
function startReconnectAttempt() {
  if (reconnectInterval) return; // 避免重复启动

  console.log('[RECONNECT] Starting reconnect attempts every 20 seconds...');
  
  reconnectInterval = setInterval(async () => {
    try {
      console.log('[RECONNECT] Fetching monitor list...');
      const response = await axios.get(`${config.MONITOR_API.BASE_URL}${config.MONITOR_API.ENDPOINTS.GET_MONITORS}`);
      const monitors = response.data;

      // 查找相同ID的监控服务器
      const targetMonitor = monitors.find(m => m.id === selectedMonitorId);
      
      if (targetMonitor) {
        console.log('[RECONNECT] Found target monitor:', targetMonitor.id);
        
        let connected = false;
        let serverUrl = null;

        // 第一次尝试：使用 public_url
        if (targetMonitor.public_url && targetMonitor.public_url.trim() !== '') {
          try {
            serverUrl = targetMonitor.public_url;
            monitorIP = targetMonitor.public_url;
            console.log('[RECONNECT] Trying public URL:', serverUrl);
            
            await axios.post(`${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.CONNECT}`, {
              clientId,
              name: currentUserInfo?.name || '',
              nickname: currentUserInfo?.nickname || ''
            });
            
            connected = true;
            console.log('[RECONNECT] Connected via public URL');
          } catch (error) {
            console.warn('[RECONNECT] Public URL failed, trying IP...');
          }
        }

        // 第二次尝试：使用 ip:port
        if (!connected) {
          serverUrl = `http://${targetMonitor.ip}:${config.MONITOR_SERVER.DEFAULT_PORT}`;
          monitorIP = targetMonitor.ip;
          console.log('[RECONNECT] Trying IP:', serverUrl);
          
          await axios.post(`${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.CONNECT}`, {
            clientId,
            name: currentUserInfo?.name || '',
            nickname: currentUserInfo?.nickname || ''
          });
          
          connected = true;
          console.log('[RECONNECT] Connected via IP');
        }

        if (connected) {
          console.log('[RECONNECT] Successfully reconnected!');
          originalServerUrl = serverUrl;
          
          // 重启心跳和截图
          startHeartbeat(serverUrl);
          stopScreenshotCapture();
          startScreenshotCapture(serverUrl);
        }
      } else {
        console.log('[RECONNECT] Target monitor not found in list');
      }
    } catch (error) {
      console.error('[RECONNECT] Reconnect attempt failed:', error.message);
    }
  }, 20000);
}

// 停止重连尝试
function stopReconnectAttempt() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    console.log('[RECONNECT] Stopped reconnect attempts');
  }
}

// 暂停考试（冻结webview）
function pauseExam() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ec-pause-exam');
    console.log('[PAUSE] Exam paused');
  }
}

// 恢复考试
function resumeExam() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ec-resume-exam');
    console.log('[RESUME] Exam resumed');
  }
}

// 开始屏幕截图
function startScreenshotCapture(serverUrl) {
  screenshotInterval = setInterval(async () => {
    if (!monitorIP) return;

    try {
      // 使用 Electron 自带的截图 API
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (sources.length > 0) {
        const screenshot = sources[0].thumbnail;
        const buffer = screenshot.toPNG();

        const FormData = require('form-data');
        const form = new FormData();
        form.append('image', buffer, config.SCREENSHOT.FILENAME);
        form.append('clientId', clientId);

        await axios.post(
          `${serverUrl}${config.MONITOR_SERVER.ENDPOINTS.SCREENSHOT}`,
          form,
          { headers: form.getHeaders() }
        );
      }
    } catch (error) {
      console.error('Screenshot failed:', error.message);
    }
  }, config.SCREENSHOT.INTERVAL); // 每30秒截图
}

// 停止屏幕截图
function stopScreenshotCapture() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 500,
    height: 650,
    resizable: false,
    movable: true,
    frame: true,
    backgroundColor: '#1e1e1e',
    title: '考生信息登记',
    icon: path.join(__dirname, 'build', 'favicon.ico'),
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  loginWindow.loadFile('login.html');
  loginWindow.setMenu(null);

  // 登录窗口关闭时退出应用
  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!mainWindow) {
      app.quit();
    }
  });
}

function createMainWindow(examUrl) {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    fullscreen: false,
    frame: true,
    alwaysOnTop: false,
    movable: true,
    resizable: true,
    backgroundColor: '#111111',
    title: '2OI监控工具',
    icon: path.join(__dirname, 'build', 'favicon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // 隐藏菜单栏
  mainWindow.setMenu(null);

  // 等待页面加载完成后发送考试URL和preload路径
  mainWindow.webContents.on('did-finish-load', () => {
    if (examUrl) {
      mainWindow.webContents.send('ec-start-exam', examUrl);
    }
    
    // 发送用户信息用于水印
    if (currentUserInfo) {
      mainWindow.webContents.send('ec-set-watermark', currentUserInfo);
    }
    
    // 发送webview-preload.js的正确路径
    const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');
    mainWindow.webContents.send('ec-set-webview-preload', webviewPreloadPath);
    
    mainWindow.show();
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[main][renderer console] level=${level} line=${line} source=${sourceId} message=${message}`);
  });

  // 开发时注释掉开发者工具，发布时彻底移除
  // mainWindow.webContents.openDevTools({ mode: 'bottom' });

  // 拦截 index.html 本身的弹窗（如果有的话）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[main] BrowserWindow new-window request:', url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (isRendererReady) {
        mainWindow.webContents.send('ec-open-new-tab', url);
      } else {
        console.warn('[main] BrowserWindow new-window request: renderer not ready, queueing', url);
        pendingNewTabUrls.push(url);
      }
    } else {
      console.warn('[main] BrowserWindow new-window request: mainWindow unavailable');
    }
    return { action: 'deny' };
  });

  // 允许最小化、最大化和关闭窗口

  // 屏蔽主窗口外壳本身的刷新快捷键
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || (input.control && input.key === 'r')) {
      event.preventDefault();
    }
  });
}

// 全局拦截所有 Webview 内触发的新标签页请求（如 target="_blank"）
app.on('web-contents-created', (event, contents) => {
  const contentsType = contents.getType();
  console.log('[main] web-contents-created, type:', contentsType);

  if (contentsType === 'webview') {
    console.log('[main] 检测到 webview，注册 setWindowOpenHandler');
    contents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[main][webview console] level=${level} line=${line} source=${sourceId} message=${message}`);
    });
    contents.setWindowOpenHandler(({ url }) => {
      console.log('[main] webview new-window:', url);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (isRendererReady) {
          mainWindow.webContents.send('ec-open-new-tab', url);
        } else {
          console.warn('[main] webview new-window: renderer not ready, queueing', url);
          pendingNewTabUrls.push(url);
        }
      } else {
        console.warn('[main] webview new-window: mainWindow unavailable');
      }
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      console.log('[main] webview will-navigate:', url);
    });
  }
});

function registerSafeQuitShortcut() {
  globalShortcut.register(SAFE_QUIT_ACCELERATOR, () => {
    isAppQuittingAllowed = true;
    app.quit(); // 允许正常退出流程，避免 close 事件被拦截后卡住
  });
}

ipcMain.handle('ec-request-exit', (_event, inputText) => {
  console.log('[main] ec-request-exit received:', inputText);
  // 使用 trim() 去除可能误敲的空格
  if (inputText && inputText.trim() === EXIT_CONFIRM_TEXT) {
    isAppQuittingAllowed = true;
    console.log('[main] exit allowed, quitting app');
    app.quit();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.on('ec-renderer-ready', (_event) => {
  console.log('[main] 渲染进程已就绪，可以接收新标签页事件');
  isRendererReady = true;
  if (pendingNewTabUrls.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
    pendingNewTabUrls.forEach((url) => {
      console.log('[main] 处理排队的新标签 URL:', url);
      mainWindow.webContents.send('ec-open-new-tab', url);
    });
    pendingNewTabUrls = [];
  }
});

ipcMain.handle('ec-select-monitor', async (_event, data) => {
  console.log('[main] 选择的监控服务器:', data.monitor);
  console.log('[main] 用户信息:', data.userInfo);
  
  // 保存用户信息用于水印
  currentUserInfo = data.userInfo;
  
  try {
    await connectToMonitor(data.monitor, data.userInfo);
    return { success: true };
  } catch (error) {
    console.error('[main] 连接失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ec-open-main-window', (_event, examUrl) => {
  console.log('[main] 打开主窗口，考试URL:', examUrl);

  // 创建主窗口
  createMainWindow(examUrl);

  // 关闭并销毁登录窗口
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.destroy();
    loginWindow = null;
  }

  return { success: true };
});

app.on('browser-window-created', (_event, win) => {
  // 登录窗口关闭时退出应用，主窗口拦截关闭事件需要口令验证
  if (win === loginWindow) {
    win.on('closed', () => {
      loginWindow = null;
      if (!mainWindow) {
        app.quit();
      }
    });
  } else if (win === mainWindow) {
    win.on('close', (event) => {
      if (!isAppQuittingAllowed) {
        event.preventDefault();
        // 触发退出对话框，与"退出比赛"按钮效果一致
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ec-trigger-exit-modal');
        }
      }
    });
  }
});

// ==========================================
// 【新增核心修复】：单实例锁，防多开与幽灵进程
// ==========================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果检测到后台已经有一个实例在运行了，当前新启动的进程直接自杀
  console.log("检测到程序已在运行，即将退出当前重复实例...");
  app.exit(0);
} else {
  // 当用户尝试打开第二个实例时，唤醒/聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 原本的生命周期逻辑放在锁的内部
  app.whenReady().then(() => {
    killBlockedProcessesOnWindows();
    createLoginWindow();
    registerSafeQuitShortcut();
    // 连接监控服务器现在通过用户选择
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopScreenshotCapture();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    stopReconnectAttempt();
  });
  app.on('window-all-closed', () => app.quit());
}
