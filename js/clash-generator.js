// ========== Clash YAML 配置生成器 ==========
// 将 VPN 管理面板中的配置转换为 Clash 兼容的 YAML 格式

const CLASH_BASE_CONFIG = {
    port: 7890,
    'socks-port': 7891,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090'
};

/**
 * 生成单条 Clash proxy 配置
 * @param {Object} server - 服务器对象
 * @param {Object} user - 用户对象
 * @returns {Object|null} Clash proxy 对象，不支持的协议返回 null
 */
function generateClashProxy(server, user) {
    var password = server.password || ('auto_' + user.id.substr(0, 10));
    var name = (server.name || server.address) + ' [' + server.protocol + ']';

    switch (server.protocol) {
        case 'Shadowsocks':
            return {
                name: name,
                type: 'ss',
                server: server.address,
                port: server.port,
                cipher: 'aes-256-gcm',
                password: password
            };

        case 'VMess':
            return {
                name: name,
                type: 'vmess',
                server: server.address,
                port: server.port,
                uuid: generateUUID(user.id),
                alterId: 0,
                cipher: 'auto',
                network: 'tcp'
            };

        case 'Trojan':
            return {
                name: name,
                type: 'trojan',
                server: server.address,
                port: server.port,
                password: password,
                sni: server.address
            };

        case 'WireGuard':
        case 'OpenVPN':
            // Clash 不原生支持 WireGuard/OpenVPN
            return null;

        default:
            // 未知协议当作 ss 处理
            return {
                name: name,
                type: 'ss',
                server: server.address,
                port: server.port,
                cipher: 'aes-256-gcm',
                password: password
            };
    }
}

/**
 * 生成完整的 Clash YAML 配置字符串
 * @param {Array} configs - 配置列表
 * @param {Array} users - 用户列表
 * @param {Array} servers - 服务器列表
 * @param {String} [filterUserId] - 可选，只生成特定用户的配置
 * @returns {String} Clash YAML 字符串
 */
function generateClashYaml(configs, users, servers, filterUserId) {
    // 构建用户/服务器快速查找表
    var userMap = {};
    users.forEach(function(u) { userMap[u.id] = u; });
    var serverMap = {};
    servers.forEach(function(s) { serverMap[s.id] = s; });

    // 收集有效的 proxy 配置
    var proxies = [];
    var skipped = [];
    var seenNames = {};

    configs.forEach(function(c) {
        if (c.disabled) return;
        if (filterUserId && c.userId !== filterUserId) return;

        var server = serverMap[c.serverId];
        var user = userMap[c.userId];
        if (!server || !user) return;

        var proxy = generateClashProxy(server, user);
        if (!proxy) {
            skipped.push(server.protocol);
            return;
        }

        // 去重：同名proxy跳过
        if (seenNames[proxy.name]) return;
        seenNames[proxy.name] = true;

        proxies.push(proxy);
    });

    // 构建 proxy 名称列表
    var proxyNames = proxies.map(function(p) { return p.name; });
    // 如果没有有效的 proxy，添加一个占位 DIRECT
    if (proxyNames.length === 0) {
        proxyNames.push('DIRECT');
    }

    // 构建 YAML
    var lines = [];

    // 基础配置
    Object.keys(CLASH_BASE_CONFIG).forEach(function(key) {
        lines.push(key + ': ' + CLASH_BASE_CONFIG[key]);
    });
    lines.push('');

    // Proxies
    lines.push('proxies:');
    if (proxies.length === 0) {
        lines.push('  # 没有有效的代理节点');
    } else {
        proxies.forEach(function(p) {
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

    // Proxy Groups
    lines.push('proxy-groups:');
    lines.push('  - name: "🚀 节点选择"');
    lines.push('    type: select');
    lines.push('    proxies:');
    proxyNames.forEach(function(name) {
        lines.push('      - "' + name + '"');
    });
    // 确保 DIRECT 在列表中
    if (proxyNames.indexOf('DIRECT') === -1) {
        lines.push('      - DIRECT');
    }

    // 只有当有多个 proxy 时才添加自动选择组
    if (proxyNames.length > 1 && proxyNames[0] !== 'DIRECT') {
        lines.push('  - name: "🎯 自动选择"');
        lines.push('    type: url-test');
        lines.push('    proxies:');
        proxyNames.forEach(function(name) {
            if (name !== 'DIRECT') {
                lines.push('      - "' + name + '"');
            }
        });
        lines.push('    url: "http://www.gstatic.com/generate_204"');
        lines.push('    interval: 300');
    }
    lines.push('');

    // Rules
    lines.push('rules:');
    lines.push('  - MATCH,🚀 节点选择');

    // 跳过的不支持协议提示
    if (skipped.length > 0) {
        lines.push('');
        lines.push('# 注意：以下协议 Clash 不原生支持，已跳过：' + skipped.join(', '));
    }

    return lines.join('\n');
}

/**
 * 生成订阅内容（base64编码的Clash YAML）
 * @param {Array} configs
 * @param {Array} users
 * @param {Array} servers
 * @param {String} [filterUserId]
 * @returns {String} base64 编码的 YAML 字符串
 */
function generateSubscriptionContent(configs, users, servers, filterUserId) {
    var yaml = generateClashYaml(configs, users, servers, filterUserId);
    // 浏览器端使用 btoa + encodeURIComponent 处理 UTF-8
    try {
        return btoa(unescape(encodeURIComponent(yaml)));
    } catch (e) {
        return btoa(yaml);
    }
}

/**
 * 获取用户订阅 URL
 * @param {String} userId
 * @param {String} [serverBase] - 服务器基础URL，默认 http://localhost:3456
 * @returns {String} 订阅 URL
 */
function getSubscriptionUrl(userId, serverBase) {
    var base = serverBase || 'http://localhost:3456';
    return base + '/sub?token=' + userId;
}
