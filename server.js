// ========== VPN Manager - 本地订阅服务器 ==========
// 零依赖 Node.js HTTP 服务器
// 为 Clash Verge / v2rayN 提供订阅链接 + 托管前端页面
// 启动: node server.js
// 默认端口: 3456 (可通过 PORT 环境变量修改)
//
// 端点说明:
//   /sub           - Clash YAML 订阅 (base64) → 用于 Clash Verge / Clash Meta
//   /sub/v2rayn    - v2rayN 链接列表 (base64) → 用于 v2rayN / v2rayNG

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

// ====== UUID 生成（确定性：同一 seed 始终生成同一 UUID v4，VMess 连接必需） ======
// 原实现会生成 32 字符长度不足的非法 UUID（如 xxxx-xxxx-4xxx-axxx-xxxxxxxx，仅 8 位），
// 导致 VMess 配置无法被任何客户端识别。这里改为生成严格合法的 36 字符 UUID v4。
function generateUUID(seed) {
    const s = String(seed);
    let h1 = 0x6a09e667, h2 = 0xbb67ae85, h3 = 0x3c6ef372, h4 = 0xa54ff53a;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193); h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
        h2 = Math.imul(h2 ^ (c + 0x9e3779b9), 0x85ebca6b); h2 = ((h2 << 11) | (h2 >>> 21)) >>> 0;
        h3 = Math.imul(h3 ^ (c ^ 0x27d4eb2f), 0x165667b1); h3 = ((h3 << 9) | (h3 >>> 23)) >>> 0;
        h4 = Math.imul(h4 ^ (c + s.charCodeAt(s.length - 1 - i)), 0x1b873632); h4 = ((h4 << 7) | (h4 >>> 25)) >>> 0;
    }
    let hex = [h1, h2, h3, h4].map(n => n.toString(16).padStart(8, '0')).join('');
    hex = hex.split('');
    hex[12] = '4'; // version = 4
    hex[16] = (parseInt(hex[16], 16) & 0x3 | 0x8).toString(16); // variant = 8/9/a/b
    const h = hex.join('');
    return h.substring(0, 8) + '-' + h.substring(8, 12) + '-' + h.substring(12, 16) +
        '-' + h.substring(16, 20) + '-' + h.substring(20, 32);
}

// ====== YAML 值转义（防止密码等特殊字符破坏 YAML 结构） ======
function yamlQuote(value) {
    const str = String(value == null ? '' : value);
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

// ====== Clash YAML 生成（服务端版本） ======
function generateClashProxyServer(server, user) {
    // 密码优先使用服务器密码，fallback 使用用户 ID 前缀
    const password = server.password || ('auto_' + (user.id || '').substring(0, 10));
    // Clash YAML 中 name 不能有特殊字符，使用原始名称（不需要 URL 编码）
    const name = (server.name || server.address) + ' [' + (server.protocol || 'Unknown') + ']';

    switch (server.protocol) {
        case 'Shadowsocks':
            return {
                name, type: 'ss', server: server.address, port: server.port,
                cipher: 'aes-256-gcm', password: password
            };
        case 'VMess':
            return {
                name, type: 'vmess', server: server.address, port: server.port,
                uuid: generateUUID(user.id), alterId: 0, cipher: 'auto', network: 'tcp'
            };
        case 'Trojan':
            return {
                name, type: 'trojan', server: server.address, port: server.port,
                password: password, sni: server.address
            };
        case 'WireGuard':
        case 'OpenVPN':
            return null;
        default:
            return {
                name, type: 'ss', server: server.address, port: server.port,
                cipher: 'aes-256-gcm', password: password
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
    lines.push('mixed-port: 7890');
    lines.push('allow-lan: false');
    lines.push('mode: rule');
    lines.push('log-level: info');
    lines.push('ipv6: false');
    lines.push('external-controller: 127.0.0.1:9090');
    lines.push('unified-delay: true');
    lines.push('tcp-concurrent: true');
    lines.push('find-process-mode: strict');
    lines.push('');
    lines.push('dns:');
    lines.push('  enable: true');
    lines.push('  listen: 0.0.0.0:1053');
    lines.push('  enhanced-mode: fake-ip');
    lines.push('  fake-ip-filter:');
    lines.push('    - "*.lan"');
    lines.push('    - "*.local"');
    lines.push('    - "localhost.ptlogin2.qq.com"');
    lines.push('  nameserver:');
    lines.push('    - 223.5.5.5');
    lines.push('    - 119.29.29.29');
    lines.push('    - 8.8.8.8');
    lines.push('  fallback:');
    lines.push('    - 1.1.1.1');
    lines.push('    - 8.8.8.8');
    lines.push('');

    lines.push('proxies:');
    if (proxies.length === 0) {
        lines.push('  # 没有有效的代理节点');
    } else {
        proxies.forEach(p => {
            lines.push('  - name: ' + yamlQuote(p.name));
            lines.push('    type: ' + p.type);
            lines.push('    server: ' + yamlQuote(p.server));
            lines.push('    port: ' + p.port);
            lines.push('    udp: true');
            if (p.cipher) lines.push('    cipher: ' + p.cipher);
            if (p.password) lines.push('    password: ' + yamlQuote(p.password));
            if (p.uuid) lines.push('    uuid: ' + p.uuid);
            if (p.alterId !== undefined) lines.push('    alterId: ' + p.alterId);
                        if (p.sni) lines.push('    sni: ' + yamlQuote(p.sni));
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

// ====== v2rayN 订阅生成（链接列表格式） ======
// 生成单条 v2rayN 兼容链接 (ss:// / vmess:// / trojan://)
function generateV2rayNLink(server, user) {
    const password = server.password || ('auto_' + (user.id || '').substring(0, 10));
    // rawName 用于 VMess JSON ps 字段（不需要编码）
    const rawName = (server.name || server.address) + ' [' + (server.protocol || 'Unknown') + ']';
    // encodedName 用于 URL fragment（# 之后）
    const encodedName = encodeURIComponent(rawName);

    switch (server.protocol) {
        case 'Shadowsocks': {
            // SIP002: 密码必须先 URL 编码再 base64，否则特殊字符(+/=&)会破坏链接
            const userinfo = Buffer.from('aes-256-gcm:' + encodeURIComponent(password), 'utf-8').toString('base64');
            return 'ss://' + userinfo + '@' + server.address + ':' + server.port + '#' + encodedName;
        }
        case 'VMess': {
            // vmess://base64(json)
            const vmessConfig = {
                v: '2',
                ps: rawName,                          // ps 用原始名称，不编码
                add: server.address,
                port: String(server.port),
                id: generateUUID(user.id),
                aid: '0',
                net: 'tcp',
                type: 'none',
                host: '',
                path: '',
                tls: ''
            };
            const json = JSON.stringify(vmessConfig);
            return 'vmess://' + Buffer.from(json, 'utf-8').toString('base64');
        }
        case 'Trojan': {
            // trojan://password@server:port?security=tls&sni=server#name
            return 'trojan://' + encodeURIComponent(password) + '@' + server.address + ':' + server.port +
                '?security=tls&sni=' + encodeURIComponent(server.address) + '#' + encodedName;
        }
        case 'WireGuard':
        case 'OpenVPN':
            return null;
        default:
            return null;
    }
}

function generateV2rayNSubscription(data, filterUserId) {
    const userMap = {};
    data.users.forEach(u => { userMap[u.id] = u; });
    const serverMap = {};
    data.servers.forEach(s => { serverMap[s.id] = s; });

    const links = [];
    const seen = {};

    data.configs.forEach(c => {
        if (c.disabled) return;
        if (filterUserId && c.userId !== filterUserId) return;

        const server = serverMap[c.serverId];
        const user = userMap[c.userId];
        if (!server || !user) return;

        const link = generateV2rayNLink(server, user);
        if (!link || seen[link]) return;
        seen[link] = true;
        links.push(link);
    });

    // base64 编码链接列表（用换行符分隔）
    return Buffer.from(links.join('\n'), 'utf-8').toString('base64');
}

// ====== 静态文件服务 ======
function serveStatic(req, res) {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // 去除 query string
    filePath = filePath.split('?')[0];
    // 安全：使用 path.resolve 防止目录穿越攻击
    // 先在路径前加 '.' 确保无法通过绝对路径逃逸，然后 resolve 并验证在项目目录内
    const fullPath = path.resolve(__dirname, '.' + filePath);
    const projectRoot = path.resolve(__dirname);
    if (!fullPath.startsWith(projectRoot + path.sep) && fullPath !== projectRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
    }

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

    // GET /sub - Clash YAML 订阅端点
    if (pathname === '/sub' && method === 'GET') {
        const token = url.searchParams.get('token');
        let base64Content;
        if (token) {
            base64Content = generateSubscriptionBase64(appData, token);
            console.log('[Server] Clash订阅请求 - 用户token: ' + token);
        } else {
            base64Content = generateSubscriptionBase64(appData, null);
            console.log('[Server] Clash订阅请求 - 全部节点');
        }
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename=clash-subscription',
            'Subscription-Userinfo': 'upload=0; download=0; total=0'
        });
        res.end(base64Content);
        return;
    }

    // GET /sub/v2rayn - v2rayN 链接列表订阅端点
    if (pathname === '/sub/v2rayn' && method === 'GET') {
        const token = url.searchParams.get('token');
        let base64Content;
        if (token) {
            base64Content = generateV2rayNSubscription(appData, token);
            console.log('[Server] v2rayN订阅请求 - 用户token: ' + token);
        } else {
            base64Content = generateV2rayNSubscription(appData, null);
            console.log('[Server] v2rayN订阅请求 - 全部节点');
        }
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename=v2rayn-subscription',
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
            clashSubscriptionUrl: 'http://localhost:' + PORT + '/sub',
            v2rayNSubscriptionUrl: 'http://localhost:' + PORT + '/sub/v2rayn'
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
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║       VPN Manager - 订阅服务器已启动              ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log('  ║  管理面板:   http://localhost:' + PORT + '                     ║');
    console.log('  ║                                                  ║');
    console.log('  ║  Clash 订阅 (YAML):                              ║');
    console.log('  ║    全部:  http://localhost:' + PORT + '/sub                  ║');
    console.log('  ║    用户:  http://localhost:' + PORT + '/sub?token=USER_ID      ║');
    console.log('  ║                                                  ║');
    console.log('  ║  v2rayN 订阅 (链接列表):                         ║');
    console.log('  ║    全部:  http://localhost:' + PORT + '/sub/v2rayn           ║');
    console.log('  ║    用户:  http://localhost:' + PORT + '/sub/v2rayn?token=USER_ID');
    console.log('  ║                                                  ║');
    // 列出有配置的用户及其订阅URL
    if (appData.users.length > 0 && appData.configs.length > 0) {
        console.log('  ║  已配置用户 (' + appData.users.length + ' 人):');
        const userConfigMap = {};
        appData.configs.forEach(c => {
            if (!c.disabled) userConfigMap[c.userId] = true;
        });
        appData.users.forEach(u => {
            if (userConfigMap[u.id]) {
                const shortUrl = 'http://localhost:' + PORT + '/sub/v2rayn?token=' + u.id;
                console.log('  ║    ' + u.name + ' → v2rayN: ' + shortUrl);
            }
        });
    }
    console.log('  ║                                                  ║');
    console.log('  ║  按 Ctrl+C 停止服务器                            ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
});
