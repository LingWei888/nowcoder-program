# 监考端 API 接口文档

## 📋 概述

本文档定义了监考端服务器需要提供的 API 接口，用于与考试客户端进行通信。

**基础地址**: `http://{monitorIP}:3000`

---

## 🔌 接口列表

### 1. 获取监控服务器列表

**接口地址**: `GET /monitors`  
**调用方**: API 中转服务器（api-acnowcoder.exitcode.cn）  
**用途**: 客户端启动时获取所有在线的监考服务器列表

#### 响应格式
```json
[
  {
    "school": "北京大学",
    "location": "理科教学楼 A101",
    "ip": "192.168.1.100",
    "status": "online"
  },
  {
    "school": "清华大学",
    "location": "计算机系 B203",
    "ip": "192.168.1.101",
    "status": "online"
  }
]
```

#### 字段说明
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| school | String | ✅ | 学校名称 |
| location | String | ✅ | 考场位置 |
| ip | String | ✅ | 监考服务器 IP 地址 |
| status | String | ✅ | 状态：online/offline |

---

### 2. 客户端连接

**接口地址**: `POST /connect`  
**调用方**: 考试客户端  
**用途**: 考生选择监考服务器后建立连接，注册考生信息

#### 请求体
```json
{
  "clientId": "2021001234",
  "name": "张三",
  "nickname": "代码小王子"
}
```

#### 字段说明
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| clientId | String | ✅ | 学号（唯一标识） |
| name | String | ✅ | 真实姓名 |
| nickname | String | ✅ | 网名（用于滚榜显示） |

#### 响应格式
```json
{
  "success": true,
  "message": "连接成功"
}
```

#### 错误响应
```json
{
  "success": false,
  "message": "该学号已注册"
}
```

---

### 3. 心跳保持

**接口地址**: `POST /heartbeat`  
**调用方**: 考试客户端  
**频率**: 每 10 秒一次  
**用途**: 维持客户端在线状态

#### 请求体
```json
{
  "clientId": "2021001234"
}
```

#### 响应格式
```json
{
  "success": true,
  "timestamp": 1714000000000
}
```

---

### 4. 上传截图

**接口地址**: `POST /screenshot`  
**调用方**: 考试客户端  
**频率**: 每 30 秒一次  
**用途**: 接收客户端屏幕截图

#### 请求格式
- **Content-Type**: `multipart/form-data`
- **表单字段**:
  - `image`: 二进制图片数据（PNG 格式）
  - `clientId`: 学号

#### 响应格式
```json
{
  "success": true,
  "savedPath": "/screenshots/2021001234_1714000000.png"
}
```

#### 存储建议
```
/screenshots/
├── 2021001234_1714000000.png
├── 2021001234_1714000030.png
└── 2021001235_1714000000.png
```

**命名规则**: `{clientId}_{timestamp}.png`

---

### 5. 获取比赛信息 ⭐ 新增

**接口地址**: `POST /get-exam-info`  
**调用方**: 考试客户端  
**用途**: 考生连接成功后获取比赛链接和密码

#### 请求体
```json
{
  "clientId": "2021001234",
  "name": "张三",
  "nickname": "代码小王子"
}
```

#### 响应格式
```json
{
  "success": true,
  "examUrl": "https://ac.nowcoder.com/acm/contest/12345",
  "password": "ABC123",
  "examTitle": "2024春季程序设计竞赛",
  "startTime": "2024-04-24T14:00:00Z",
  "endTime": "2024-04-24T17:00:00Z"
}
```

#### 字段说明
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| success | Boolean | ✅ | 请求是否成功 |
| examUrl | String | ✅ | 比赛页面完整 URL |
| password | String | ❌ | 比赛密码（如果有） |
| examTitle | String | ❌ | 比赛标题 |
| startTime | String | ❌ | 比赛开始时间（ISO 8601） |
| endTime | String | ❌ | 比赛结束时间（ISO 8601） |

#### 错误响应
```json
{
  "success": false,
  "message": "未找到该考生的比赛信息"
}
```

---

## 🛠️ 监考端实现示例（Node.js + Express）

```javascript
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置 multer 处理文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './screenshots';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const clientId = req.body.clientId;
    const timestamp = Date.now();
    cb(null, `${clientId}_${timestamp}.png`);
  }
});
const upload = multer({ storage });

// 存储连接的客户端
const connectedClients = new Map();

// 1. 获取监控服务器列表（由 API 中转服务器调用）
app.get('/monitors', (req, res) => {
  res.json([
    {
      school: '北京大学',
      location: '理科教学楼 A101',
      ip: '192.168.1.100',
      status: 'online'
    }
  ]);
});

// 2. 客户端连接
app.post('/connect', (req, res) => {
  const { clientId, name, nickname } = req.body;
  
  if (connectedClients.has(clientId)) {
    return res.status(400).json({
      success: false,
      message: '该学号已注册'
    });
  }
  
  connectedClients.set(clientId, {
    name,
    nickname,
    connectedAt: new Date(),
    lastHeartbeat: Date.now()
  });
  
  console.log(`考生连接: ${clientId} - ${name} (${nickname})`);
  
  res.json({
    success: true,
    message: '连接成功'
  });
});

// 3. 心跳保持
app.post('/heartbeat', (req, res) => {
  const { clientId } = req.body;
  
  if (connectedClients.has(clientId)) {
    const client = connectedClients.get(clientId);
    client.lastHeartbeat = Date.now();
    
    res.json({
      success: true,
      timestamp: Date.now()
    });
  } else {
    res.status(404).json({
      success: false,
      message: '客户端未连接'
    });
  }
});

// 4. 上传截图
app.post('/screenshot', upload.single('image'), (req, res) => {
  const { clientId } = req.body;
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: '未接收到图片'
    });
  }
  
  console.log(`收到截图: ${clientId}, 文件: ${req.file.filename}`);
  
  res.json({
    success: true,
    savedPath: req.file.path
  });
});

// 5. 获取比赛信息 ⭐ 新增
app.post('/get-exam-info', (req, res) => {
  const { clientId, name, nickname } = req.body;
  
  // 验证客户端是否已连接
  if (!connectedClients.has(clientId)) {
    return res.status(403).json({
      success: false,
      message: '请先连接监考服务器'
    });
  }
  
  // TODO: 从数据库或配置文件读取比赛信息
  // 这里返回示例数据
  const examInfo = {
    success: true,
    examUrl: 'https://ac.nowcoder.com/acm/contest/12345',
    password: 'ABC123',
    examTitle: '2024春季程序设计竞赛',
    startTime: '2024-04-24T14:00:00Z',
    endTime: '2024-04-24T17:00:00Z'
  };
  
  console.log(`发送比赛信息给: ${clientId}`);
  
  res.json(examInfo);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`监考服务器运行在 http://localhost:${PORT}`);
});
```

---

## 📦 依赖安装

```bash
npm init -y
npm install express multer cors
```

---

## 🔒 安全建议

1. **IP 白名单**: 只允许特定网段的客户端连接
2. **速率限制**: 防止恶意请求（如使用 `express-rate-limit`）
3. **数据验证**: 对所有输入进行严格验证
4. **日志记录**: 记录所有关键操作
5. **HTTPS**: 生产环境建议使用 HTTPS

---

## 📊 监考端功能清单

### 必需功能
- ✅ 维护在线客户端列表
- ✅ 接收并存储截图
- ✅ 心跳检测（超时自动断开）
- ✅ 提供比赛信息查询接口

### 可选功能
- 📹 实时查看考生屏幕（WebSocket）
- 📊 考生状态监控面板
- 🚨 异常行为报警
- 📈 统计数据导出
- 🔍 截图检索和回放

---

## 🧪 测试接口

### 使用 curl 测试

```bash
# 1. 测试连接
curl -X POST http://localhost:3000/connect \
  -H "Content-Type: application/json" \
  -d '{"clientId":"2021001234","name":"张三","nickname":"代码小王子"}'

# 2. 测试心跳
curl -X POST http://localhost:3000/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"clientId":"2021001234"}'

# 3. 获取比赛信息
curl -X POST http://localhost:3000/get-exam-info \
  -H "Content-Type: application/json" \
  -d '{"clientId":"2021001234","name":"张三","nickname":"代码小王子"}'

# 4. 上传截图
curl -X POST http://localhost:3000/screenshot \
  -F "image=@test.png" \
  -F "clientId=2021001234"
```

---

## 📝 注意事项

1. **clientId 唯一性**: 学号作为唯一标识，不允许重复连接
2. **截图清理**: 建议定期清理旧截图，避免磁盘占满
3. **超时处理**: 超过 60 秒未心跳的客户端视为离线
4. **并发处理**: 考虑多考生同时上传截图的性能问题
5. **错误处理**: 所有接口都需要完善的错误处理

---

**版本**: v1.0  
**更新日期**: 2024-04-24
