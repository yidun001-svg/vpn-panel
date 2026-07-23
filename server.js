// ========== VPN Manager - 本地订阅服务器 ==========
// 零依赖 Node.js HTTP 服务器
// 为 Clash Verge 提供订阅链接 + 托管前端页面
// 启动: node server.js
// 默认端口: 3456 (可通过 PORT 环境变量修改)

const http = require('http');
const fs = require('fs');
const path = require('path');

// ====== 配置 ======
const PORT = parseInt(process.env.PORT) || 3456;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'vpn-data.json');

// ====== MIME 类型 ======
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.conf': 'text/plain; charset=utf-8',
    '.yaml': 'text/yaml; charset=utf-8',
    '.yml': 'text/yaml; charset=utf-8'
};

// ====== 数据管理 ======
let appData = loadData();

function loadData() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const data = JSON.parse(raw);
            return normalizeData(data);
        }
    } catch (e) {
        console.error('[Server] 读取数据文件失败:', e.message);
    }
    // 返回空数据模板
    return {
        users: [],
        servers: [],
        configs: [],
        activities: [],
        trafficRecords: [],
        settings: {
            siteName: 'VPN管理面板',
            defaultExpireDays: 30,
            defaultTrafficLimit: 100,
            notifyEmail: ''
        }
    };
}

function saveData(data) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('[Server] 保存数据失败:', e.message);
        return false;
    }
}

function normalizeData(data) {
    return {
        users: data.users || [],
        servers: data.servers || [],
        configs: data.configs || [],
        activities: data.activities || [],
        trafficRecords: data.trafficRecords || [],
        settings: data.settings || { siteName: 'VPN管理面板', defaultExpireDays: 30, defaultTrafficLimit: 100, notifyEmail: '' }
    };
}

// ====== UUID 生成（与前端逻辑保持一致） ======
function generateUUID(seed) {
    const s = seed + Date.now().toString(36);
    let hash = 0;
    for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return hex.substr(0, 8) + '-' + hex.substr(0, 4) + '-4' + hex.substr(0, 3) + '-a' + hex.substr(0, 3) + '-' + hex.substr(0, 12);
}

// ====== Clash YAML 生成（服务端版本） ======
function generateClashProxyServer(server, user) {
    const password = server.password || ('auto_' + (user.id || '').substring(0, 10));
    const name = (server.name || server.address) + ' [' + (server.protocol || 'Unknown') + ']';

    switch (server.protocol) {
        case 'Shadowsocks':
            return {
                name, type: 'ss', server: server.address, port: server.port,
                cipher: 'aes-256-gcm', password
            };
        case 'VMess':
            return {
                name, type: 'vmess', server: server.address, port: server.port,
                uuid: generateUUID(user.id), alterId: 0, cipher: 'auto', network: 'tcp'
            };
        case 'Trojan':
            return {
                name, type: 'trojan', server: server.address, port: server.port,
                password, sni: server.address
            };
        case 'WireGuard':
        case 'OpenVPN':
            return null;
        default:
            return {
                name, type: 'ss', server: server.address, port: server.port,
                cipher: 'aes-256-gcm', password
            };
    }
}

function generateClashYamlServer(data, filterUserId) {
    const userMap = {};
    data.users.forEach(u => { userMap[u.id] = u; });
    const serverMap = {};
    data.servers.forEach(s => { serverMap[s.id] = s; });

    const proxies = [];
    const seenNames = {};

    data.configs.forEach(c => {
        if (c.disabled) return;
        if (filterUserId && c.userId !== filterUserId) return;

        const server = serverMap[c.serverId];
        const user = userMap[c.userId];
        if (!server || !user) return;

        const proxy = generateClashProxyServer(server, user);
        if (!proxy || seenNames[proxy.name]) return;
        seenNames[proxy.name] = true;
        proxies.push(proxy);
    });

    const proxyNames = proxies.map(p => p.name);
    if (proxyNames.length === 0) {
        proxyNames.push('DIRECT');
    }

    const lines = [];

    // 注意：订阅 profile 只包含 proxies/proxy-groups/rules，
    // 不包含 Clash 内核设置（port/socks-port/external-controller 等），
    // 这些由 Clash Verge 自己管理，包含它们会导致 "the remote profile data is invalid" 错误。

    lines.push('proxies:');
    if (proxies.length === 0) {
        lines.push('  # 没有有效的代理节点');
    } else {
        proxies.forEach(p => {
            lines.push('  - name: "' + p.name + '"');
            lines.push('    type: ' + p.type);
            lines.push('    server: ' + p.server);
            lines.push('    port: ' + p.port);
            if (p.cipher) lines.push('    cipher: ' + p.cipher);
            if (p.password) lines.push('    password: "' + p.password + '"');
            if (p.uuid) lines.push('    uuid: ' + p.uuid);
            if (p.alterId !== undefined) lines.push('    alterId: ' + p.alterId);
            if (p.sni) lines.push('    sni: ' + p.sni);
            if (p.network) lines.push('    network: ' + p.network);
        });
    }
    lines.push('');

    lines.push('proxy-groups:');
    lines.push('  - name: "节点选择"');
    lines.push('    type: select');
    lines.push('    proxies:');
    proxyNames.forEach(name => lines.push('      - "' + name + '"'));
    if (!proxyNames.includes('DIRECT')) {
        lines.push('      - DIRECT');
    }

    if (proxyNames.length > 1 && proxyNames[0] !== 'DIRECT') {
        lines.push('  - name: "自动选择"');
        lines.push('    type: url-test');
        lines.push('    proxies:');
        proxyNames.forEach(name => {
            if (name !== 'DIRECT') lines.push('      - "' + name + '"');
        });
        lines.push('    url: "http://www.gstatic.com/generate_204"');
        lines.push('    interval: 300');
    }
    lines.push('');

    lines.push('rules:');
    lines.push('  - MATCH,节点选择');

    return lines.join('\n');
}

function generateSubscriptionBase64(data, filterUserId) {
    const yaml = generateClashYamlServer(data, filterUserId);
    return Buffer.from(yaml, 'utf-8').toString('base64');
}

// ====== 静态文件服务 ======
function serveStatic(req, res) {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // 去除 query string
    filePath = filePath.split('?')[0];
    // 安全：防止目录穿越
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, filePath);

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// ====== API 路由 ======
function handleAPI(req, res) {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // GET /api/data - 获取完整数据
    if (pathname === '/api/data' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(appData));
        return;
    }

    // POST /api/sync - 前端同步数据到服务器
    if (pathname === '/api/sync' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                appData = normalizeData(data);
                const saved = saveData(appData);
                if (saved) {
                    console.log('[Server] 数据已同步 (users:' + appData.users.length + ' servers:' + appData.servers.length + ' configs:' + appData.configs.length + ')');
                }
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true, saved: saved }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }

    // GET /sub - 订阅端点
    if (pathname === '/sub' && method === 'GET') {
        const token = url.searchParams.get('token');
        let base64Content;
        if (token) {
            // 按用户过滤
            base64Content = generateSubscriptionBase64(appData, token);
            console.log('[Server] 订阅请求 - 用户token: ' + token + ' (proxies in data)');
        } else {
            // 返回所有配置
            base64Content = generateSubscriptionBase64(appData, null);
            console.log('[Server] 订阅请求 - 全部节点');
        }
        // 注意：不要加 Content-Disposition: attachment，否则 Clash Verge 无法正确解析
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Subscription-Userinfo': 'upload=0; download=0; total=0'
        });
        res.end(base64Content);
        return;
    }

    // GET /api/status - 服务器状态
    if (pathname === '/api/status' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'running',
            port: PORT,
            users: appData.users.length,
            servers: appData.servers.length,
            configs: appData.configs.length,
            subscriptionUrl: 'http://localhost:' + PORT + '/sub'
        }));
        return;
    }

    // 未匹配的 API 路由
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API not found' }));
}

// ====== 启动服务器 ======
const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    // API 路由
    if (url.startsWith('/api/') || url.startsWith('/sub')) {
        handleAPI(req, res);
        return;
    }

    // 静态文件服务
    serveStatic(req, res);
});

server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║     VPN Manager - 订阅服务器已启动       ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log('  ║  管理面板: http://localhost:' + PORT + '          ║');
    console.log('  ║  全部订阅: http://localhost:' + PORT + '/sub       ║');
    console.log('  ║  用户订阅: http://localhost:' + PORT + '/sub?token=USER_ID');
    console.log('  ║                                          ║');
    // 列出有配置的用户及其订阅URL
    if (appData.users.length > 0 && appData.configs.length > 0) {
        console.log('  ║  可用订阅链接:');
        const userConfigMap = {};
        appData.configs.forEach(c => {
            if (!c.disabled) userConfigMap[c.userId] = true;
        });
        appData.users.forEach(u => {
            if (userConfigMap[u.id]) {
                console.log('  ║    用户 [' + u.name + ']: http://localhost:' + PORT + '/sub?token=' + u.id);
            }
        });
    }
    console.log('  ║                                          ║');
    console.log('  ║  按 Ctrl+C 停止服务器                     ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
});
