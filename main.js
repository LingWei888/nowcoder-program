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

      // 选择第一个在线的监控服务器
      selectedMonitor = monitors[0];
    }

    monitorIP = selectedMonitor.ip;
    clientId = userInfo ? userInfo.studentId : getClientId();

    // 连接到监控服务器
    await axios.post(`http://${monitorIP}:${config.MONITOR_SERVER.DEFAULT_PORT}${config.MONITOR_SERVER.ENDPOINTS.CONNECT}`, {
      clientId,
      name: userInfo?.name || '',
      nickname: userInfo?.nickname || ''
    });
    console.log(`Connected to monitor ${monitorIP} as ${clientId}`);

    // 启动心跳
    setInterval(() => {
      axios.post(`http://${monitorIP}:${config.MONITOR_SERVER.DEFAULT_PORT}${config.MONITOR_SERVER.ENDPOINTS.HEARTBEAT}`, { clientId })
        .catch(err => console.error('Heartbeat failed:', err.message));
    }, 10000);

    // 启动屏幕截图
    startScreenshotCapture();

  } catch (error) {
    console.error('Failed to connect to monitor:', error.message);
  }
}

// 开始屏幕截图
function startScreenshotCapture() {
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
          `http://${monitorIP}:${config.MONITOR_SERVER.DEFAULT_PORT}${config.MONITOR_SERVER.ENDPOINTS.SCREENSHOT}`,
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
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    movable: false,
    resizable: false,
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

  // 等待页面加载完成后发送考试URL
  mainWindow.webContents.on('did-finish-load', () => {
    if (examUrl) {
      mainWindow.webContents.send('ec-start-exam', examUrl);
    }
    
    // 发送用户信息用于水印
    if (currentUserInfo) {
      mainWindow.webContents.send('ec-set-watermark', currentUserInfo);
    }
    
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

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(true);
  });

  mainWindow.on('minimize', (event) => event.preventDefault());

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
  win.on('close', (event) => {
    if (!isAppQuittingAllowed) event.preventDefault();
  });
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
  });
  app.on('window-all-closed', () => app.quit());
}
