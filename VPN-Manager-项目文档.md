# VPN Manager - 项目文档

> VPN 管理面板 + Clash Verge 订阅服务器，支持 Shadowsocks / VMess / Trojan 多协议配置管理与一键订阅。

---

## 1. 项目概览

这是一个离线的 VPN 配置管理工具，包含：

- **前端管理面板**：纯 HTML/CSS/JS 单页应用，管理用户、服务器、VPN 配置
- **后端订阅服务器**：Node.js HTTP 服务器，为 Clash Verge 等客户端提供标准订阅链接
- **Clash YAML 生成器**：将 SS/VMess/Trojan 配置转为 Clash 兼容格式

### 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，Chart.js 图表，localStorage 存储 |
| 后端 | Node.js 内置模块 | http + fs + path，零 npm 依赖 |
| 数据 | JSON 文件 + localStorage | 前端本地存储 + 服务端文件持久化 |

---

## 2. 文件结构

```
vpn-manager/
├── index.html               # 管理面板主页面
├── server.js                 # Node.js 订阅服务器（零依赖）
├── package.json              # npm 启动脚本
├── 启动服务.bat              # Windows 一键启动脚本
├── css/
│   └── style.css             # 面板样式（CSS Variables 主题）
├── js/
│   ├── app.js                # 管理面板核心逻辑
│   └── clash-generator.js    # Clash YAML 配置生成器
└── data/
    └── .gitkeep              # 服务端数据存储目录
```

---

## 3. 快速开始

### 环境要求

- **Node.js** ≥ v18（已测试 v24.15.0）
- **浏览器**：Chrome / Edge / Firefox 现代版本
- **Clash Verge**（可选，用于订阅）

### 方式一：双击启动（推荐）

双击 `启动服务.bat` → 自动打开浏览器 → `http://localhost:3456`

### 方式二：命令行启动

```bash
cd vpn-manager
npm start
# 或
node server.js
```

### 方式三：纯前端模式

直接双击 `index.html`，使用浏览器打开（无订阅服务器功能）。

---

## 4. 功能说明

### 4.1 管理面板

| 模块 | 功能 |
|---|---|
| **控制台** | 总览面板：用户数、服务器数、流量图表、最近活动 |
| **用户管理** | 添加/编辑/删除用户，设置套餐、流量限额、到期时间 |
| **服务器管理** | 添加/编辑/删除服务器，配置地址、端口、协议、密码 |
| **配置管理** | 为用户生成 VPN 配置，支持查看/复制/下载/批量导出 |
| **订阅管理** | Clash YAML 导出、服务器状态检测、用户订阅链接管理 |
| **流量统计** | 按时间段统计流量，用户流量排行 |
| **系统设置** | 站点设置、数据导入/导出、防火墙规则、审计日志 |

### 4.2 支持的协议

| 协议 | 管理面板 | Clash YAML | 订阅端点 |
|---|---|---|---|
| Shadowsocks | ✅ | ✅ | ✅ |
| VMess | ✅ | ✅ | ✅ |
| Trojan | ✅ | ✅ | ✅ |
| WireGuard | ✅ | ❌ | 跳过 |
| OpenVPN | ✅ | ❌ | 跳过 |

> WireGuard 和 OpenVPN 在 Clash 中不原生支持，生成 YAML 时会自动跳过。

### 4.3 Clash Verge 订阅

服务器启动后，提供以下端点：

| URL | 说明 |
|---|---|
| `http://localhost:3456` | 管理面板 |
| `http://localhost:3456/sub` | 全部节点订阅 |
| `http://localhost:3456/sub?token=<用户ID>` | 指定用户订阅 |
| `http://localhost:3456/api/data` | GET 获取全部数据 |
| `http://localhost:3456/api/sync` | POST 同步数据 |
| `http://localhost:3456/api/status` | 服务器状态 |

---

## 5. API 接口

### GET /api/status

服务器状态检测。

```json
{
  "status": "running",
  "port": 3456,
  "users": 3,
  "servers": 5,
  "configs": 8,
  "subscriptionUrl": "http://localhost:3456/sub"
}
```

### GET /api/data

获取完整数据。

```json
{
  "users": [...],
  "servers": [...],
  "configs": [...],
  "settings": {...}
}
```

### POST /api/sync

前端同步数据到服务器。Body 为完整 JSON 数据对象。

```json
{ "ok": true, "saved": true }
```

### GET /sub?token=<userId>

返回 base64 编码的 Clash YAML 配置（标准订阅格式）。

- 带 `token` 参数：仅返回该用户的代理节点
- 不带参数：返回所有代理节点

---

## 6. 数据流

```
┌──────────────────────────────────────────────────┐
│                  浏览器                           │
│  ┌────────────┐     ┌──────────────────────┐     │
│  │ localStorage│     │  管理面板 (SPA)       │     │
│  │ (加密存储)  │◄───►│  - 用户管理           │     │
│  └────────────┘     │  - 服务器管理          │     │
│                      │  - 配置生成            │     │
│                      │  - Clash YAML 导出     │     │
│                      └──────┬───────────────┘     │
│                             │ POST /api/sync      │
└─────────────────────────────┼────────────────────┘
                              │
┌─────────────────────────────┼────────────────────┐
│                   Node.js 服务器                   │
│  ┌──────────┐     ┌────────┴───────┐             │
│  │ JSON 文件 │◄───►│  HTTP Server   │             │
│  │ (data/)  │     │  port 3456     │             │
│  └──────────┘     └────────┬───────┘             │
│                             │ GET /sub?token=xxx  │
└─────────────────────────────┼────────────────────┘
                              │
                     ┌────────┴────────┐
                     │   Clash Verge   │
                     │  (订阅导入)     │
                     └─────────────────┘
```

### 数据同步机制

- **file:// 模式**：数据仅存 localStorage
- **HTTP 模式**：操作数据后自动同步到服务器（500ms 防抖）
- **首次 HTTP 访问**：如果本地无数据，自动从服务器 `/api/data` 拉取
- **迁移数据**：旧版（file://）导出 JSON → 新版（HTTP）导入

---

## 7. 生成 Clash YAML 示例

```yaml
port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
external-controller: 127.0.0.1:9090

proxies:
  - name: "US-SS-01 [Shadowsocks]"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-256-gcm
    password: "your-password"
  - name: "HK-VMESS-01 [VMess]"
    type: vmess
    server: 5.6.7.8
    port: 443
    cipher: auto
    uuid: xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx
    alterId: 0
    network: tcp
  - name: "JP-TROJAN-01 [Trojan]"
    type: trojan
    server: 9.10.11.12
    port: 443
    password: "your-password"
    sni: 9.10.11.12

proxy-groups:
  - name: "节点选择"
    type: select
    proxies:
      - "US-SS-01 [Shadowsocks]"
      - "HK-VMESS-01 [VMess]"
      - "JP-TROJAN-01 [Trojan]"
      - DIRECT
  - name: "自动选择"
    type: url-test
    proxies:
      - "US-SS-01 [Shadowsocks]"
      - "HK-VMESS-01 [VMess]"
      - "JP-TROJAN-01 [Trojan]"
    url: "http://www.gstatic.com/generate_204"
    interval: 300

rules:
  - MATCH,节点选择
```

---

## 8. 在 Clash Verge 中使用

1. 双击 `启动服务.bat`（或在终端运行 `npm start`）
2. 打开管理面板 `http://localhost:3456`
3. 添加用户 → 添加服务器 → 生成配置
4. 进入 **订阅管理** → **同步数据到服务器**
5. 复制用户的订阅链接（如 `http://localhost:3456/sub?token=user1`）
6. 打开 Clash Verge → **配置** → 粘贴订阅链接 → **下载**

---

## 9. 注意事项

- **数据存储**：`file://` 和 `http://localhost:3456` 是不同的 localStorage 域名，首次切换需导出导入
- **自动同步**：HTTP 模式下，所有修改自动同步到服务器，关浏览器也不丢数据
- **关闭服务器**：关闭命令行窗口即可
- **端口冲突**：如 3456 端口被占用，`启动服务.bat` 会自动清理，也可通过 `PORT=9090 node server.js` 指定端口
- **安全提醒**：本项目为本地工具，请勿暴露到公网

---

## 10. 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | - | 初始版本：用户/服务器/配置管理 |
| 1.1.0 | 2026-07 | 新增 Clash YAML 生成器、订阅服务器、一键启动脚本 |
