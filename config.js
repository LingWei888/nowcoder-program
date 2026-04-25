// 配置文件 - 统一管理所有API接口地址
module.exports = {
  // 监控服务器API
  MONITOR_API: {
    BASE_URL: 'http://api-acnowcoder.exitcode.cn',
    ENDPOINTS: {
      GET_MONITORS: '/monitors'
    }
  },

  // 监控服务器连接配置
  MONITOR_SERVER: {
    DEFAULT_PORT: 3000,
    ENDPOINTS: {
      CONNECT: '/connect',
      HEARTBEAT: '/heartbeat',
      SCREENSHOT: '/screenshot'
    }
  },

  // 截图配置
  SCREENSHOT: {
    INTERVAL: 30000, // 每30秒截图一次
    FILENAME: 'exam_screenshot.png'
  },

  // 退出确认配置
  EXIT: {
    CONFIRM_TEXT: '我同意结束这场比赛',
    SAFE_QUIT_ACCELERATOR: 'CommandOrControl+Shift+Alt+Q'
  },

  // 被禁止的进程列表
  BLOCKED_PROCESSES: [
    'QQ.exe','Weixin.exe','msedge.exe','chrome.exe', 'WeChat.exe', 'DingTalk.exe', 'WXWork.exe', 'TIM.exe',
    'ToDesk.exe', 'SunloginClient.exe', 'SunloginRemote.exe',
    'TeamViewer.exe', 'AnyDesk.exe', 'RustDesk.exe', 'ToDesk_Service.exe'
  ],

  // 考试相关配置
  EXAM: {
    URL: 'https://ac.nowcoder.com/',
    ALLOW_HOST_KEYWORD: 'nowcoder.com'
  }
};
