// ========== VPN 部署向导 ==========
// 为海外服务器生成一键部署脚本，支持 WireGuard / Shadowsocks / OpenVPN / V2Ray / IPsec

// ====== 预检函数片段（每个脚本注入头部） ======
var PREFLIGHT_SCRIPT = [
    '# ====== 前置检查 ======',
    'echo ">>> 执行环境检查..."',
    'OS_NAME=$(grep "^ID=" /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\')',
    'OS_VER=$(grep "VERSION_ID=" /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \'"\')',
    'echo "  系统: $OS_NAME $OS_VER"',
    'if ! echo "$OS_NAME" | grep -qiE "ubuntu|debian"; then',
    '    echo "  ⚠️  此脚本专为 Ubuntu/Debian 设计，其他系统可能不兼容"',
    'fi',
    'TOTAL_MEM=$(free -m 2>/dev/null | awk \'/^Mem:/{print $2}\')',
    'echo "  内存: ${TOTAL_MEM:-?} MB"',
    'if [ -n "$TOTAL_MEM" ] && [ "$TOTAL_MEM" -lt {{MIN_RAM}} ]; then',
    '    echo "  ⚠️⚠️⚠️  警告：内存不足！最低需要 {{MIN_RAM}} MB，当前仅 ${TOTAL_MEM} MB"',
    '    echo "  部署可能失败或运行不稳定"',
    '    read -p "  按 Enter 继续或 Ctrl+C 取消..."',
    'fi',
    'PORT_CHECK={{PORT}}',
    'if ss -tuln 2>/dev/null | grep -q ":$PORT_CHECK\\b"; then',
    '    echo "  ⚠️  端口 $PORT_CHECK 已被占用！"',
    '    echo "  正在占用的进程:"',
    '    ss -tulnp 2>/dev/null | grep ":$PORT_CHECK\\b" || netstat -tulnp 2>/dev/null | grep ":$PORT_CHECK\\b"',
    '    read -p "  按 Enter 继续（可能冲突）或 Ctrl+C 取消..."',
    'fi',
    'echo "  ✅ 检查通过"',
    'echo ""',
    ''
].join('\n');

// ====== 协议定义 ======
var VPN_PROTOCOLS = [
    {
        id: 'wireguard',
        name: 'WireGuard',
        icon: 'fa-bolt',
        tag: '强烈推荐',
        tagClass: 'success',
        desc: '极简现代 VPN，内核原生支持，速度最快，配置只需几行。全平台客户端，移动端省电。',
        score: { speed: 5, security: 5, ease: 5, memory: 1 },
        minRam: '128',
        port: 51820,
        pros: ['极快：代码仅 4000 行，接近网卡线速', '省电：移动端 Wi-Fi/蜂窝无缝漫游', '简单：服务端配置只需一个 ini 文件', '安全：state-of-the-art 加密（Noise + ChaCha20）'],
        cons: ['国内直连偶尔被 QoS，海外用无此问题', '不支持 TCP 伪装，无内置流量混淆'],
        setupScript: '#!/bin/bash\n' +
'# ========== WireGuard 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========\n' +
'# 适用于你的 VPS (128MB RAM 即可)\n' +
'\n' +
'set -e\n' +
'\n' +
'# ---- 配置区（可修改）----\n' +
'WG_PORT={{PORT}}\n' +
'WG_INTERFACE=wg0\n' +
'WG_NETWORK=10.66.66.0/24\n' +
'SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")\n' +
'\n' +
'echo "========================================"\n' +
'echo "  WireGuard 一键部署"\n' +
'echo "  服务器IP: $SERVER_IP"\n' +
'echo "  端口: $WG_PORT"\n' +
'echo "========================================"\n' +
'\n' +
'# ---- 1. 安装 WireGuard ----\n' +
'apt update && apt install -y wireguard qrencode iptables-persistent\n' +
'\n' +
'# ---- 2. 生成密钥 ----\n' +
'mkdir -p /etc/wireguard\n' +
'cd /etc/wireguard\n' +
'wg genkey | tee server_private.key | wg pubkey > server_public.key\n' +
'wg genkey | tee client_private.key | wg pubkey > client_public.key\n' +
'\n' +
'SERVER_PRIV=$(cat server_private.key)\n' +
'SERVER_PUB=$(cat server_public.key)\n' +
'CLIENT_PRIV=$(cat client_private.key)\n' +
'CLIENT_PUB=$(cat client_public.key)\n' +
'\n' +
'# ---- 3. 开启 IP 转发 ----\n' +
'echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf\n' +
'echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf\n' +
'sysctl -p\n' +
'\n' +
'# ---- 4. 服务器配置 ----\n' +
'DEFAULT_IFACE=$(ip route | grep default | awk \'{print $5}\' | head -1)\n' +
'echo "检测到默认网卡: $DEFAULT_IFACE"\n' +
'\n' +
'cat > /etc/wireguard/wg0.conf << WGEOF\n' +
'[Interface]\n' +
'Address = 10.66.66.1/24\n' +
'ListenPort = $WG_PORT\n' +
'PrivateKey = $SERVER_PRIV\n' +
'PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o $DEFAULT_IFACE -j MASQUERADE\n' +
'PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o $DEFAULT_IFACE -j MASQUERADE\n' +
'\n' +
'[Peer]\n' +
'# 客户端 1\n' +
'PublicKey = $CLIENT_PUB\n' +
'AllowedIPs = 10.66.66.2/32\n' +
'WGEOF\n' +
'\n' +
'# ---- 5. 客户端配置 ----\n' +
'cat > /etc/wireguard/client.conf << WGEOF\n' +
'[Interface]\n' +
'PrivateKey = $CLIENT_PRIV\n' +
'Address = 10.66.66.2/24\n' +
'DNS = 1.1.1.1, 8.8.8.8\n' +
'\n' +
'[Peer]\n' +
'PublicKey = $SERVER_PUB\n' +
'Endpoint = $SERVER_IP:$WG_PORT\n' +
'AllowedIPs = 0.0.0.0/0, ::/0\n' +
'PersistentKeepalive = 25\n' +
'WGEOF\n' +
'\n' +
'# ---- 6. 启动服务 ----\n' +
'systemctl enable wg-quick@wg0\n' +
'systemctl start wg-quick@wg0\n' +
'\n' +
'# ---- 7. 防火墙 ----\n' +
'ufw allow $WG_PORT/udp 2>/dev/null || iptables -A INPUT -p udp --dport $WG_PORT -j ACCEPT\n' +
'\n' +
'echo ""\n' +
'echo "=============================="\n' +
'echo "  WireGuard 部署完成！"\n' +
'echo "=============================="\n' +
'echo ""\n' +
'echo "📱 客户端配置文件: /etc/wireguard/client.conf"\n' +
'echo ""\n' +
'echo "🔗 QR 码（手机扫一扫即可导入）:"\n' +
'qrencode -t ansiutf8 < /etc/wireguard/client.conf 2>/dev/null || echo "(qrencode 未安装，跳过 QR)"\n' +
'echo ""\n' +
'cat /etc/wireguard/client.conf\n' +
'echo ""\n' +
'echo "📋 管理面板配置信息（复制到面板中添加服务器）:"\n' +
'echo "   协议: WireGuard"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $WG_PORT"\n' +
'echo "   服务器公钥: $SERVER_PUB"\n' +
'echo "   客户端私钥: $CLIENT_PRIV"\n' +
'echo ""\n' +
'echo "📱 客户端下载: https://www.wireguard.com/install/"\n'
    },
    {
        id: 'shadowsocks',
        name: 'Shadowsocks-rust',
        icon: 'fa-ghost',
        tag: '推荐',
        tagClass: 'info',
        desc: '轻量级加密代理，Rust 实现速度极快。适合翻墙，但不支持全流量 VPN（需额外配置 tun2socks）。支持 SIP003 插件。',
        score: { speed: 5, security: 4, ease: 4, memory: 1 },
        minRam: '64',
        port: 8388,
        pros: ['极轻量：512MB VPS 跑几十个用户没问题', '速度极快：Rust 实现，单核跑满千兆', '抗封锁强：支持 v2ray-plugin / cloak 等混淆插件', '你的管理面板已原生支持 SS 协议'],
        cons: ['本身是 SOCKS5 代理，不是全流量 VPN', '需配合 Clash Verge / V2RayN 等客户端使用', 'UDP 支持较 OpenVPN 弱'],
        setupScript: '#!/bin/bash\n' +
'# ========== Shadowsocks-rust 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========\n' +
'# 轻量代理，64MB VPS 即可运行\n' +
'\n' +
'set -e\n' +
'\n' +
'SS_PORT={{PORT}}\n' +
'SS_PASSWORD=$(openssl rand -hex 16)\n' +
'SS_METHOD="aes-256-gcm"\n' +
'SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")\n' +
'\n' +
'echo "========================================"\n' +
'echo "  Shadowsocks-rust 一键部署"\n' +
'echo "  服务器IP: $SERVER_IP"\n' +
'echo "  端口: $SS_PORT"\n' +
'echo "  密码: $SS_PASSWORD"\n' +
'echo "  加密: $SS_METHOD"\n' +
'echo "========================================"\n' +
'\n' +
'apt update && apt install -y curl\n' +
'\n' +
'# ---- 安装 shadowsocks-rust (官方预编译二进制) ----\n' +
'SS_VERSION=$(curl -s https://api.github.com/repos/shadowsocks/shadowsocks-rust/releases/latest | grep tag_name | cut -d\'"\' -f4)\n' +
'ARCH=$(uname -m)\n' +
'case $ARCH in\n' +
'    x86_64)  SS_ARCH="x86_64-unknown-linux-gnu" ;;\n' +
'    aarch64) SS_ARCH="aarch64-unknown-linux-gnu" ;;\n' +
'    *) echo "不支持架构: $ARCH"; exit 1 ;;\n' +
'esac\n' +
'\n' +
'cd /usr/local/bin\n' +
'curl -L -o ss.tar.xz "https://github.com/shadowsocks/shadowsocks-rust/releases/download/${SS_VERSION}/shadowsocks-${SS_VERSION}.${SS_ARCH}.tar.xz"\n' +
'tar xf ss.tar.xz\n' +
'rm ss.tar.xz\n' +
'\n' +
'# ---- 配置文件 ----\n' +
'mkdir -p /etc/shadowsocks\n' +
'cat > /etc/shadowsocks/config.json << SSEOF\n' +
'{\n' +
'    "server": "0.0.0.0",\n' +
'    "server_port": $SS_PORT,\n' +
'    "password": "$SS_PASSWORD",\n' +
'    "method": "$SS_METHOD",\n' +
'    "fast_open": true,\n' +
'    "mode": "tcp_and_udp",\n' +
'    "timeout": 300\n' +
'}\n' +
'SSEOF\n' +
'\n' +
'# ---- systemd 服务 ----\n' +
'cat > /etc/systemd/system/shadowsocks.service << \'SVCEOF\'\n' +
'[Unit]\n' +
'Description=Shadowsocks-rust Server\n' +
'After=network.target\n' +
'\n' +
'[Service]\n' +
'Type=simple\n' +
'ExecStart=/usr/local/bin/ssserver -c /etc/shadowsocks/config.json\n' +
'Restart=on-failure\n' +
'RestartSec=5\n' +
'\n' +
'[Install]\n' +
'WantedBy=multi-user.target\n' +
'SVCEOF\n' +
'\n' +
'systemctl daemon-reload\n' +
'systemctl enable shadowsocks\n' +
'systemctl start shadowsocks\n' +
'\n' +
'# ---- 防火墙 ----\n' +
'if command -v ufw >/dev/null 2>&1; then\n' +
'    ufw allow $SS_PORT/tcp 2>/dev/null || true\n' +
'    ufw allow $SS_PORT/udp 2>/dev/null || true\n' +
'    ufw allow 22/tcp 2>/dev/null || true\n' +
'else\n' +
'    iptables -A INPUT -p tcp --dport $SS_PORT -j ACCEPT\n' +
'    iptables -A INPUT -p udp --dport $SS_PORT -j ACCEPT\n' +
'    iptables -A INPUT -p tcp --dport 22 -j ACCEPT\n' +
'    apt-get install -y iptables-persistent 2>/dev/null && netfilter-persistent save 2>/dev/null || true\n' +
'fi\n' +
'\n' +
'# ---- 生成 SS URI ----\n' +
'SS_PASSWORD_ENCODED=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1],safe=\'\'))" "$SS_PASSWORD" 2>/dev/null || echo "$SS_PASSWORD")\n' +
'SS_USERINFO=$(echo -n "$SS_METHOD:$SS_PASSWORD_ENCODED" | base64 -w0)\n' +
'SS_URI_SIP002="ss://${SS_USERINFO}@${SERVER_IP}:${SS_PORT}"\n' +
'\n' +
'echo ""\n' +
'echo "=============================="\n' +
'echo "  Shadowsocks 部署完成！"\n' +
'echo "=============================="\n' +
'echo ""\n' +
'echo "📋 连接信息:"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $SS_PORT"\n' +
'echo "   密码: $SS_PASSWORD"\n' +
'echo "   加密: $SS_METHOD"\n' +
'echo ""\n' +
'echo "🔗 SS URI (v2rayN/Clash 导入):"\n' +
'echo "   ${SS_URI_SIP002}"\n' +
'echo ""\n' +
'echo "📋 管理面板配置信息:"\n' +
'echo "   协议: Shadowsocks"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $SS_PORT"\n' +
'echo "   密码: $SS_PASSWORD"\n' +
'echo ""\n' +
'echo "📱 客户端: Clash Verge / V2RayN / Shadowrocket / v2rayNG"\n'
    },
    {
        id: 'v2ray',
        name: 'V2Ray (Xray)',
        icon: 'fa-cube',
        tag: '推荐',
        tagClass: 'info',
        desc: '全能代理平台，支持 VMess/VLESS/Trojan/Shadowsocks 等多种协议。Xray 是 V2Ray 的超集，性能更好。抗封锁能力最强。',
        score: { speed: 4, security: 5, ease: 3, memory: 2 },
        minRam: '256',
        port: 443,
        pros: ['协议最全：VMess/VLESS/Trojan/Shadowsocks 通吃', '抗封锁最强：XTLS 流控 + REALITY 可完美伪装', '路由灵活：可分流国内外流量', '你的管理面板已原生支持 VMess/Trojan'],
        cons: ['配置复杂度高', '服务端内存约 50-80MB', '不是全流量 VPN，需客户端配合'],
        setupScript: '#!/bin/bash\n' +
'# ========== Xray (V2Ray 超集) 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========\n' +
'# 256MB VPS 可运行，建议搭配 VLESS + XTLS 获得最佳性能\n' +
'\n' +
'set -e\n' +
'\n' +
'XRAY_PORT={{PORT}}\n' +
'SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")\n' +
'UUID=$(cat /proc/sys/kernel/random/uuid)\n' +
'\n' +
'echo "========================================"\n' +
'echo "  Xray 一键部署 (VLESS + XTLS-Vision)"\n' +
'echo "  服务器IP: $SERVER_IP"\n' +
'echo "  端口: $XRAY_PORT"\n' +
'echo "  UUID: $UUID"\n' +
'echo "========================================"\n' +
'\n' +
'# ---- 安装 Xray ----\n' +
'apt update && apt install -y curl unzip\n' +
'bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install\n' +
'\n' +
'# ---- 生成 REALITY 密钥 ----\n' +
'REALITY_KEYS=$(xray x25519)\n' +
'REALITY_PRIV=$(echo "$REALITY_KEYS" | grep "Private key" | awk \'{print $3}\')\n' +
'REALITY_PUB=$(echo "$REALITY_KEYS" | grep "Public key" | awk \'{print $3}\')\n' +
'SHORT_ID=$(openssl rand -hex 8)\n' +
'\n' +
'echo "REALITY 密钥已生成"\n' +
'\n' +
'# ---- 配置文件 ----\n' +
'cat > /usr/local/etc/xray/config.json << XEOF\n' +
'{\n' +
'  "log": { "loglevel": "warning" },\n' +
'  "inbounds": [{\n' +
'    "port": $XRAY_PORT,\n' +
'    "protocol": "vless",\n' +
'    "settings": {\n' +
'      "clients": [{\n' +
'        "id": "$UUID",\n' +
'        "flow": "xtls-rprx-vision"\n' +
'      }],\n' +
'      "decryption": "none"\n' +
'    },\n' +
'    "streamSettings": {\n' +
'      "network": "tcp",\n' +
'      "security": "reality",\n' +
'      "realitySettings": {\n' +
'        "dest": "www.microsoft.com:443",\n' +
'        "serverNames": ["www.microsoft.com", "microsoft.com"],\n' +
'        "privateKey": "$REALITY_PRIV",\n' +
'        "shortIds": ["$SHORT_ID"]\n' +
'      }\n' +
'    }\n' +
'  }],\n' +
'  "outbounds": [{\n' +
'    "protocol": "freedom",\n' +
'    "tag": "direct"\n' +
'  }]\n' +
'}\n' +
'XEOF\n' +
'\n' +
'# ---- 启动服务 ----\n' +
'systemctl enable xray\n' +
'systemctl restart xray\n' +
'\n' +
'# ---- 防火墙 ----\n' +
'ufw allow $XRAY_PORT/tcp 2>/dev/null || iptables -A INPUT -p tcp --dport $XRAY_PORT -j ACCEPT\n' +
'\n' +
'echo ""\n' +
'echo "=============================="\n' +
'echo "  Xray 部署完成！"\n' +
'echo "=============================="\n' +
'echo ""\n' +
'echo "📋 VLESS + XTLS-Vision + REALITY 连接信息:"\n' +
'echo "   协议: VLESS"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $XRAY_PORT"\n' +
'echo "   UUID: $UUID"\n' +
'echo "   流控: xtls-rprx-vision"\n' +
'echo "   传输: tcp"\n' +
'echo "   安全: reality"\n' +
'echo "   公钥: $REALITY_PUB"\n' +
'echo "   shortId: $SHORT_ID"\n' +
'echo ""\n' +
'echo "📱 客户端: V2RayN (Win) / V2Box (Mac) / Shadowrocket (iOS) / v2rayNG (Android)"\n' +
'echo ""\n' +
'echo "📋 管理面板配置信息:"\n' +
'echo "   协议: VMess（面板兼容模式）或 VLESS"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $XRAY_PORT"\n' +
'echo "   UUID: $UUID"\n'
    },
    {
        id: 'openvpn',
        name: 'OpenVPN',
        icon: 'fa-lock',
        tag: '可用',
        tagClass: 'warning',
        desc: '传统 SSL VPN，兼容性最好（几乎任何设备都能连）。但速度较慢，配置复杂，移动端耗电。256MB VPS 勉强能跑。',
        score: { speed: 2, security: 4, ease: 2, memory: 3 },
        minRam: '256',
        port: 1194,
        pros: ['兼容性最好：Win/Mac/Linux/iOS/Android/路由器全支持', '基于 SSL/TLS，可通过 443 端口伪装', 'UDP 和 TCP 双模式', '社区成熟，教程最多'],
        cons: ['配置极其复杂（CA/证书/DH 参数）', '速度慢：用户态 TUN 设备 + 多层加密开销', '移动端费电，切换网络重连慢', '小内存 VPS 仅建议 1-2 人使用'],
        setupScript: '#!/bin/bash\n' +
'# ========== OpenVPN 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========\n' +
'# ⚠️ 256MB VPS 勉强可跑，建议只 1-2 个用户\n' +
'\n' +
'set -e\n' +
'\n' +
'OVPN_PORT={{PORT}}\n' +
'OVPN_PROTO=udp\n' +
'SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")\n' +
'\n' +
'echo "========================================"\n' +
'echo "  OpenVPN 一键部署"\n' +
'echo "  服务器IP: $SERVER_IP"\n' +
'echo "  端口: $OVPN_PORT/$OVPN_PROTO"\n' +
'echo "========================================"\n' +
'\n' +
'apt update && apt install -y openvpn easy-rsa curl\n' +
'\n' +
'# ---- 配置 CA 和证书 ----\n' +
'make-cadir /etc/openvpn/easy-rsa\n' +
'cd /etc/openvpn/easy-rsa\n' +
'\n' +
'./easyrsa init-pki\n' +
'echo -e "\\n" | ./easyrsa build-ca nopass\n' +
'./easyrsa gen-dh\n' +
'./easyrsa build-server-full server nopass\n' +
'./easyrsa build-client-full client nopass\n' +
'./easyrsa gen-crl\n' +
'\n' +
'openvpn --genkey secret /etc/openvpn/ta.key\n' +
'\n' +
'# ---- 服务器配置 ----\n' +
'cat > /etc/openvpn/server.conf << OVEOF\n' +
'port $OVPN_PORT\n' +
'proto $OVPN_PROTO\n' +
'dev tun\n' +
'ca /etc/openvpn/easy-rsa/pki/ca.crt\n' +
'cert /etc/openvpn/easy-rsa/pki/issued/server.crt\n' +
'key /etc/openvpn/easy-rsa/pki/private/server.key\n' +
'dh /etc/openvpn/easy-rsa/pki/dh.pem\n' +
'tls-auth /etc/openvpn/ta.key 0\n' +
'data-ciphers AES-256-GCM:AES-128-GCM\n' +
'auth SHA256\n' +
'server 10.8.0.0 255.255.255.0\n' +
'push "redirect-gateway def1 bypass-dhcp"\n' +
'push "dhcp-option DNS 1.1.1.1"\n' +
'push "dhcp-option DNS 8.8.8.8"\n' +
'keepalive 10 120\n' +
'persist-key\n' +
'persist-tun\n' +
'user nobody\n' +
'group nogroup\n' +
'status /var/log/openvpn-status.log\n' +
'log /var/log/openvpn.log\n' +
'verb 3\n' +
'OVEOF\n' +
'\n' +
'# ---- 开启 IP 转发 ----\n' +
'echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p\n' +
'\n' +
'# ---- iptables NAT ----\n' +
'IFACE=$(ip route | grep default | awk \'{print $5}\')\n' +
'iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o $IFACE -j MASQUERADE\n' +
'iptables-save > /etc/iptables/rules.v4 2>/dev/null || true\n' +
'\n' +
'# ---- 启动 ----\n' +
'systemctl enable openvpn@server\n' +
'systemctl start openvpn@server\n' +
'\n' +
'# ---- 生成客户端配置 ----\n' +
'cat > /etc/openvpn/client.ovpn << OVEOF\n' +
'client\n' +
'dev tun\n' +
'proto $OVPN_PROTO\n' +
'remote $SERVER_IP $OVPN_PORT\n' +
'resolv-retry infinite\n' +
'nobind\n' +
'persist-key\n' +
'persist-tun\n' +
'remote-cert-tls server\n' +
'data-ciphers AES-256-GCM:AES-128-GCM\n' +
'auth SHA256\n' +
'verb 3\n' +
'<ca>\n' +
'$(cat /etc/openvpn/easy-rsa/pki/ca.crt)\n' +
'</ca>\n' +
'<cert>\n' +
'$(sed -n \'/BEGIN CERTIFICATE/,/END CERTIFICATE/p\' /etc/openvpn/easy-rsa/pki/issued/client.crt)\n' +
'</cert>\n' +
'<key>\n' +
'$(cat /etc/openvpn/easy-rsa/pki/private/client.key)\n' +
'</key>\n' +
'<tls-auth>\n' +
'$(cat /etc/openvpn/ta.key)\n' +
'</tls-auth>\n' +
'key-direction 1\n' +
'OVEOF\n' +
'\n' +
'# ---- 防火墙 ----\n' +
'ufw allow $OVPN_PORT/$OVPN_PROTO 2>/dev/null || iptables -A INPUT -p $OVPN_PROTO --dport $OVPN_PORT -j ACCEPT\n' +
'\n' +
'echo ""\n' +
'echo "=============================="\n' +
'echo "  OpenVPN 部署完成！"\n' +
'echo "=============================="\n' +
'echo ""\n' +
'echo "📋 客户端配置文件: /etc/openvpn/client.ovpn"\n' +
'echo ""\n' +
'echo "📋 管理面板配置信息:"\n' +
'echo "   协议: OpenVPN"\n' +
'echo "   地址: $SERVER_IP"\n' +
'echo "   端口: $OVPN_PORT"\n' +
'echo ""\n' +
'echo "📱 客户端下载: https://openvpn.net/client/"\n'
    },
    {
        id: 'ipsec',
        name: 'IPsec/IKEv2',
        icon: 'fa-shield-halved',
        tag: '不推荐',
        tagClass: 'danger',
        desc: 'iOS/macOS/Windows 原生支持，无需安装客户端。但配置极其复杂，占用高，小内存 VPS 不够用。仅适合≥1GB VPS。',
        score: { speed: 3, security: 5, ease: 1, memory: 5 },
        minRam: '1024',
        port: 500,
        pros: ['系统原生支持：iOS/macOS/Windows 无需装 App', '安全等级高：IPsec 是企业级标准', '连接速度快'],
        cons: ['配置极其复杂：strongSwan + 证书体系', '资源占用高：小内存 VPS 跑不动', 'UDP 500/4500 端口可能被运营商封', '国内直连极易被 QoS'],
        setupScript: '#!/bin/bash\n' +
'# ========== IPsec/IKEv2 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========\n' +
'# ⚠️⚠️⚠️ 严重警告：此协议需要至少 1GB 内存！\n' +
'\n' +
'set -e\n' +
'\n' +
'SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || curl -s4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")\n' +
'\n' +
'echo "========================================"\n' +
'echo "  ⚠️  警告：IPsec 需要至少 1GB 内存！"\n' +
'echo "  强烈建议改用 WireGuard"\n' +
'echo "  按 Ctrl+C 取消，等待 10 秒继续..."\n' +
'echo "========================================"\n' +
'sleep 10\n' +
'\n' +
'VPN_USER="vpnuser"\n' +
'VPN_PASSWORD=$(openssl rand -base64 12)\n' +
'\n' +
'apt update && apt install -y strongswan strongswan-pki libcharon-extra-plugins\n' +
'\n' +
'# ---- 生成证书 ----\n' +
'mkdir -p /etc/ipsec.d/private /etc/ipsec.d/certs /etc/ipsec.d/cacerts\n' +
'\n' +
'pki --gen --type rsa --size 2048 --outform pem > /etc/ipsec.d/private/ca-key.pem\n' +
'pki --self --ca --lifetime 3650 --in /etc/ipsec.d/private/ca-key.pem \\\n' +
'    --dn "CN=VPN CA" --outform pem > /etc/ipsec.d/cacerts/ca-cert.pem\n' +
'\n' +
'pki --gen --type rsa --size 2048 --outform pem > /etc/ipsec.d/private/server-key.pem\n' +
'pki --pub --in /etc/ipsec.d/private/server-key.pem | \\\n' +
'    pki --issue --lifetime 1825 --cacert /etc/ipsec.d/cacerts/ca-cert.pem \\\n' +
'    --cakey /etc/ipsec.d/private/ca-key.pem \\\n' +
'    --dn "CN=$SERVER_IP" --san $SERVER_IP --flag serverAuth --flag ikeIntermediate \\\n' +
'    --outform pem > /etc/ipsec.d/certs/server-cert.pem\n' +
'\n' +
'# ---- strongSwan 配置 ----\n' +
'cat > /etc/ipsec.conf << IKEEOF\n' +
'config setup\n' +
'    charondebug="ike 2, knl 2, cfg 2"\n' +
'\n' +
'conn ikev2-vpn\n' +
'    auto=add\n' +
'    compress=no\n' +
'    type=tunnel\n' +
'    keyexchange=ikev2\n' +
'    fragmentation=yes\n' +
'    forceencaps=yes\n' +
'    dpdaction=clear\n' +
'    dpddelay=300s\n' +
'    rekey=no\n' +
'    left=%any\n' +
'    leftid=@$SERVER_IP\n' +
'    leftcert=server-cert.pem\n' +
'    leftsendcert=always\n' +
'    leftsubnet=0.0.0.0/0\n' +
'    right=%any\n' +
'    rightid=%any\n' +
'    rightauth=eap-mschapv2\n' +
'    rightsourceip=10.10.10.0/24\n' +
'    rightdns=1.1.1.1,8.8.8.8\n' +
'    rightsendcert=never\n' +
'    eap_identity=%identity\n' +
'IKEEOF\n' +
'\n' +
'cat > /etc/ipsec.secrets << IKEEOF\n' +
': RSA "server-key.pem"\n' +
'$VPN_USER : EAP "$VPN_PASSWORD"\n' +
'IKEEOF\n' +
'\n' +
'# ---- 防火墙 & 转发 ----\n' +
'echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p\n' +
'IFACE=$(ip route | grep default | awk \'{print $5}\')\n' +
'iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -o $IFACE -j MASQUERADE\n' +
'\n' +
'ufw allow 500/udp 2>/dev/null || iptables -A INPUT -p udp --dport 500 -j ACCEPT\n' +
'ufw allow 4500/udp 2>/dev/null || iptables -A INPUT -p udp --dport 4500 -j ACCEPT\n' +
'\n' +
'systemctl enable strongswan\n' +
'systemctl restart strongswan\n' +
'\n' +
'echo ""\n' +
'echo "=============================="\n' +
'echo "  IPsec/IKEv2 部署完成！"\n' +
'echo "=============================="\n' +
'echo ""\n' +
'echo "⚠️  提醒：小内存运行 IPsec 不稳定，建议改用 WireGuard"\n' +
'echo ""\n' +
'echo "📋 连接信息:"\n' +
'echo "   服务器: $SERVER_IP"\n' +
'echo "   用户名: $VPN_USER"\n' +
'echo "   密码: $VPN_PASSWORD"\n' +
'echo "   类型: IKEv2"\n' +
'echo ""\n' +
'echo "📱 连接方式:"\n' +
'echo "   Win/macOS/iOS: 系统设置 → VPN → 添加 IKEv2 → 填入以上信息"\n' +
'echo "   Android: 下载 strongSwan 客户端"\n'
    }
];

// ====== 部署历史记录 ======
function getDeployHistory() {
    try {
        return JSON.parse(localStorage.getItem('vpn_deploy_history') || '[]');
    } catch (e) {
        return [];
    }
}

function addDeployHistory(protocolId, serverIP, serverPort) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    var history = getDeployHistory();
    history.unshift({
        id: Date.now().toString(36),
        time: new Date().toISOString(),
        protocol: proto ? proto.name : protocolId,
        protocolId: protocolId,
        serverIP: serverIP,
        serverPort: serverPort
    });
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem('vpn_deploy_history', JSON.stringify(history));
}

// ====== 页面渲染 ======
function renderVpnDeploy() {
    var page = document.getElementById('page-deploy');
    if (!page) return;

    window._deployServerIP = window._deployServerIP || '';
    window._deployServerPort = window._deployServerPort || '';

    var html = '';

    // 服务器信息卡片
    html += '<div class="card deploy-server-card">';
    html += '<h3><i class="fas fa-cloud"></i> 目标服务器</h3>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">';

    // 从已保存服务器选择
    html += '<div class="form-group" style="margin:0;flex:1;min-width:200px">';
    html += '<label>从已保存服务器选择（可选）</label>';
    html += '<select id="deployServerSelect" onchange="onDeployServerSelect()" style="width:100%">';
    html += '<option value="">-- 手动输入 --</option>';
    if (appData && appData.servers) {
        appData.servers.forEach(function(s) {
            html += '<option value="' + escapeHtml(s.id) + '" data-ip="' + escapeHtml(s.address) + '" data-port="' + s.port + '" data-protocol="' + escapeHtml(s.protocol) + '">' + escapeHtml(s.name) + ' (' + escapeHtml(s.address) + ':' + s.port + ' ' + escapeHtml(s.protocol) + ')</option>';
        });
    }
    html += '</select></div>';

    html += '<div class="form-group" style="margin:0"><label>服务器 IP</label><input type="text" id="deployServerIP" value="' + escapeHtml(window._deployServerIP) + '" style="width:200px;font-family:monospace" onchange="updateSshCommand()"></div>';
    html += '<div class="form-group" style="margin:0"><label>SSH 端口</label><input type="text" id="deployServerSSH" value="22" style="width:80px" onchange="updateSshCommand()"></div>';
    html += '<div class="form-group" style="margin:0"><label>SSH 用户</label><input type="text" id="deployServerUser" value="root" style="width:100px" onchange="updateSshCommand()"></div>';
    html += '</div>';

    // SSH 连接命令
    html += '<div style="background:#1e293b;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px">';
    html += '<code id="sshCommandDisplay" style="color:#4ade80;font-size:14px;font-family:Consolas,Monaco,monospace;flex:1">ssh root@YOUR_IP</code>';
    html += '<button class="btn btn-primary btn-sm" onclick="copySshCommand()"><i class="fas fa-copy"></i> 复制</button>';
    html += '</div>';

    // SSH 使用提示
    html += '<details style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">';
    html += '<summary style="cursor:pointer;color:var(--primary);font-weight:500"><i class="fas fa-question-circle"></i> 不知道怎么 SSH？点这里看步骤</summary>';
    html += '<div style="margin-top:8px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);line-height:1.8">';
    html += '<strong>① 获取 root 密码：</strong>打开 VPS 管理面板 → 找到 Root Password 设置<br>';
    html += '<strong>② 打开终端：</strong>Windows 按 <kbd>Win+R</kbd> 输入 <code>cmd</code> 回车<br>';
    html += '<strong>③ 连接：</strong>复制上方绿色命令 → 粘贴到终端 → 回车<br>';
    html += '<strong>④ 输入密码：</strong>粘贴 root 密码（输入时不显示字符，正常）→ 回车<br>';
    html += '<strong>⑤ 部署：</strong>连上后，点下方任一协议的「一键复制脚本」→ 粘贴到终端 → 回车执行</div>';
    html += '</details>';
    html += '</div>';

    // 协议卡片
    html += '<div class="deploy-grid">';

    VPN_PROTOCOLS.forEach(function(proto) {
        html += '<div class="deploy-card" id="deploy-card-' + proto.id + '">';
        html += '<div class="deploy-card-header">';
        html += '<div class="deploy-card-icon"><i class="fas ' + proto.icon + '"></i></div>';
        html += '<div class="deploy-card-title">';
        html += '<h4>' + proto.name + '</h4>';
        html += '<span class="deploy-tag tag-' + proto.tagClass + '">' + proto.tag + '</span>';
        html += '</div></div>';

        html += '<p class="deploy-card-desc">' + proto.desc + '</p>';

        html += '<div class="deploy-scores">';
        html += '<div class="score-row"><span>速度</span><span class="score-stars">' + renderStars(proto.score.speed) + '</span></div>';
        html += '<div class="score-row"><span>安全</span><span class="score-stars">' + renderStars(proto.score.security) + '</span></div>';
        html += '<div class="score-row"><span>易用</span><span class="score-stars">' + renderStars(proto.score.ease) + '</span></div>';
        html += '<div class="score-row"><span>资源占用</span><span class="score-stars">' + renderMemStars(proto.score.memory) + '</span></div>';
        html += '</div>';

        html += '<div class="deploy-ram"><i class="fas fa-microchip"></i> 最低内存: <strong>' + proto.minRam + ' MB</strong></div>';
        html += '<div class="deploy-port">默认端口: <code>' + proto.port + '</code></div>';

        html += '<div class="deploy-pros-cons">';
        html += '<div class="deploy-pros"><strong>✅ 优点</strong><ul>';
        proto.pros.forEach(function(p) { html += '<li>' + p + '</li>'; });
        html += '</ul></div>';
        html += '<div class="deploy-cons"><strong>⚠️ 注意</strong><ul>';
        proto.cons.forEach(function(c) { html += '<li>' + c + '</li>'; });
        html += '</ul></div>';
        html += '</div>';

        html += '<div class="deploy-actions">';
        html += '<button class="btn btn-primary" onclick="showDeployScript(\'' + proto.id + '\')"><i class="fas fa-terminal"></i> 查看部署脚本</button>';
        html += '<button class="btn btn-secondary" onclick="copyDeployScript(\'' + proto.id + '\')"><i class="fas fa-copy"></i> 一键复制脚本</button>';
        html += '</div>';

        html += '</div>';
    });

    html += '</div>';

    // 部署历史
    var history = getDeployHistory();
    if (history.length > 0) {
        html += '<div class="card" style="margin-top:24px">';
        html += '<h3><i class="fas fa-history"></i> 部署历史 (' + history.length + ')</h3>';
        html += '<table class="data-table"><thead><tr><th>时间</th><th>协议</th><th>服务器</th><th>端口</th></tr></thead><tbody>';
        history.slice(0, 10).forEach(function(h) {
            html += '<tr><td>' + formatDate(h.time) + '</td><td><strong>' + escapeHtml(h.protocol) + '</strong></td><td><code>' + escapeHtml(h.serverIP) + '</code></td><td>' + h.serverPort + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<button class="btn btn-sm btn-secondary" onclick="clearDeployHistory()" style="margin-top:8px"><i class="fas fa-trash"></i> 清除历史</button>';
        html += '</div>';
    }

    page.innerHTML = html;
    setTimeout(updateSshCommand, 50);
}

function renderStars(count) {
    var s = '';
    for (var i = 0; i < 5; i++) {
        s += '<i class="fas fa-star star' + (i < count ? ' filled' : ' empty') + '"></i>';
    }
    return s;
}

function renderMemStars(count) {
    var s = '';
    for (var i = 0; i < 5; i++) {
        s += '<i class="fas fa-circle mem-dot' + (i < count ? ' filled' : ' empty') + '"></i>';
    }
    return s;
}

// ====== 已保存服务器选择 ======
function onDeployServerSelect() {
    var sel = document.getElementById('deployServerSelect');
    var ipInput = document.getElementById('deployServerIP');
    if (!sel || !ipInput) return;
    var opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) {
        window._deployServerIP = '';
        ipInput.value = '';
        ipInput.readOnly = false;
        ipInput.style.background = '';
    } else {
        var ip = opt.getAttribute('data-ip') || '';
        window._deployServerIP = ip;
        ipInput.value = ip;
        ipInput.readOnly = true;
        ipInput.style.background = '#f1f5f9';
    }
    updateSshCommand();
}

// ====== SSH 命令辅助 ======
function updateSshCommand() {
    var user = document.getElementById('deployServerUser');
    var ip = document.getElementById('deployServerIP');
    var port = document.getElementById('deployServerSSH');
    var display = document.getElementById('sshCommandDisplay');
    if (!display) return;
    var u = user ? user.value.trim() || 'root' : 'root';
    var i = ip ? ip.value.trim() || 'YOUR_IP' : 'YOUR_IP';
    var p = port ? port.value.trim() || '22' : '22';
    if (p === '22') {
        display.textContent = 'ssh ' + u + '@' + i;
    } else {
        display.textContent = 'ssh -p ' + p + ' ' + u + '@' + i;
    }
}

function copySshCommand() {
    var display = document.getElementById('sshCommandDisplay');
    if (!display) return;
    var cmd = display.textContent;
    navigator.clipboard.writeText(cmd).then(function() {
        showToast('SSH 命令已复制！打开 cmd/PowerShell 粘贴执行', 'success');
    }).catch(function() {
        showToast('复制失败，请手动复制绿色命令', 'error');
    });
}

// ====== 脚本生成 ======
function getDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return '';

    var customPort = window._deployServerPort || '';
    var port = customPort || proto.port;

    var preflight = PREFLIGHT_SCRIPT
        .replace(/{{MIN_RAM}}/g, proto.minRam)
        .replace(/{{PORT}}/g, String(port));

    var script = proto.setupScript.replace(/{{PORT}}/g, String(port));

    return preflight + '\n' + script;
}

// ====== 脚本展示 ======
function showDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

    var currentPort = window._deployServerPort || proto.port;
    var script = getDeployScript(protocolId);
    window._currentDeployProtocol = protocolId;

    var ipEl = document.getElementById('deployServerIP');
    var serverIP = ipEl ? ipEl.value.trim() : 'YOUR_SERVER_IP';

    var html = '<div class="form-group">';
    html += '<label>协议</label><div><strong>' + proto.name + '</strong> <span class="deploy-tag tag-' + proto.tagClass + '">' + proto.tag + '</span></div>';
    html += '</div>';

    html += '<div class="form-group">';
    html += '<label>端口</label>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<input type="number" id="deployScriptPort" value="' + currentPort + '" style="width:120px" min="1" max="65535" oninput="onDeployPortChange()">';
    html += '<span style="font-size:12px;color:var(--text-muted)">修改端口后脚本实时更新</span>';
    html += '</div></div>';

    html += '<div class="form-group">';
    html += '<label>部署脚本 (SSH 到服务器后粘贴执行)</label>';
    html += '<textarea readonly id="deployScriptContent" style="width:100%;height:400px;font-family:Consolas,Monaco,monospace;font-size:12px;background:#1e293b;color:#e2e8f0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;resize:vertical">' + escapeHtml(script) + '</textarea>';
    html += '</div>';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary" onclick="copyDeployScriptContent()"><i class="fas fa-copy"></i> 复制脚本</button>';
    html += '<button class="btn btn-secondary" onclick="downloadDeployScript(\'' + protocolId + '\')"><i class="fas fa-download"></i> 下载 .sh 文件</button>';
    html += '<button class="btn btn-success" onclick="markDeployed(\'' + protocolId + '\')" style="background:#22c55e;color:#fff"><i class="fas fa-check-circle"></i> 已部署，添加服务器</button>';
    html += '</div>';

    html += '<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:var(--radius-sm);font-size:12px;color:#92400e">';
    html += '<strong><i class="fas fa-lightbulb"></i> 使用步骤：</strong><br>';
    html += '1. 复制上方脚本<br>';
    html += '2. SSH 连接到你的服务器: <code>ssh root@' + escapeHtml(serverIP) + '</code><br>';
    html += '3. 粘贴脚本 → 回车执行<br>';
    html += '4. 等待完成，记下输出的连接信息<br>';
    html += '5. 点击「已部署，添加服务器」快速添加到管理面板';
    html += '</div>';

    openModal('部署: ' + proto.name, html);
}

// ====== 端口修改时实时更新脚本 ======
function onDeployPortChange() {
    var portInput = document.getElementById('deployScriptPort');
    var scriptArea = document.getElementById('deployScriptContent');
    if (!portInput || !scriptArea) return;

    var newPort = portInput.value.trim();
    if (!newPort || isNaN(newPort) || newPort < 1 || newPort > 65535) return;
    window._deployServerPort = newPort;

    var protocolId = window._currentDeployProtocol;
    if (!protocolId) return;

    scriptArea.value = getDeployScript(protocolId);
}

// ====== 一键复制脚本 ======
function copyDeployScript(protocolId) {
    var script = getDeployScript(protocolId);
    var ipEl = document.getElementById('deployServerIP');
    var serverIP = ipEl ? ipEl.value.trim() : 'YOUR_SERVER_IP';
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    var port = window._deployServerPort || (proto ? proto.port : '?');

    navigator.clipboard.writeText(script).then(function() {
        showToast('部署脚本已复制！SSH 到服务器粘贴执行即可', 'success');
        addAuditLog('复制部署脚本', '协议: ' + (proto ? proto.name : protocolId) + ', 目标: ' + serverIP + ':' + port);
    }).catch(function() {
        showToast('复制失败，请手动选择', 'error');
    });
}

function copyDeployScriptContent() {
    var ta = document.getElementById('deployScriptContent');
    if (!ta) return;
    // 重新生成脚本以使用最新端口
    var protocolId = window._currentDeployProtocol;
    if (protocolId) {
        var portInput = document.getElementById('deployScriptPort');
        if (portInput) {
            window._deployServerPort = portInput.value.trim();
        }
        ta.value = getDeployScript(protocolId);
    }
    navigator.clipboard.writeText(ta.value).then(function() {
        showToast('脚本已复制到剪贴板', 'success');
    }).catch(function() {
        showToast('复制失败，请手动选择文本', 'error');
    });
}

// ====== 下载脚本文件 ======
function downloadDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

    var portInput = document.getElementById('deployScriptPort');
    if (portInput) {
        window._deployServerPort = portInput.value.trim();
    }

    var script = getDeployScript(protocolId);
    var blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'deploy-' + proto.id + '.sh';
    a.click();
    URL.revokeObjectURL(url);
    showToast('脚本已下载: deploy-' + proto.id + '.sh', 'success');
    addAuditLog('下载部署脚本', '协议: ' + proto.name);
}

// ====== 标记已部署 & 添加服务器到面板 ======
function markDeployed(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

    var ipEl = document.getElementById('deployServerIP');
    var portInput = document.getElementById('deployScriptPort');
    var serverIP = ipEl ? ipEl.value.trim() : 'YOUR_SERVER_IP';
    var serverPort = portInput ? parseInt(portInput.value) || proto.port : proto.port;

    addDeployHistory(protocolId, serverIP, serverPort);
    addAuditLog('部署VPN服务', '协议: ' + proto.name + ', 服务器: ' + serverIP + ':' + serverPort);
    showToast('已记录部署: ' + proto.name + ' → ' + serverIP + ':' + serverPort, 'success');

    showAddServerAfterDeploy(protocolId, serverIP, serverPort);
}

function showAddServerAfterDeploy(protocolId, serverIP, serverPort) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

    var existing = appData.servers.find(function(s) {
        return s.address === serverIP && s.port === serverPort;
    });

    var serverProtocol = protocolId === 'shadowsocks' ? 'Shadowsocks' :
                         protocolId === 'v2ray' ? 'VMess' :
                         protocolId === 'openvpn' ? 'OpenVPN' :
                         protocolId === 'wireguard' ? 'WireGuard' : 'Shadowsocks';

    var html = '<div style="padding:8px 0">';
    html += '<div style="margin-bottom:16px;padding:12px;background:#dcfce7;border-radius:8px;color:#166534;font-size:13px">';
    html += '<i class="fas fa-check-circle"></i> <strong>' + proto.name + '</strong> 已部署到 <code>' + escapeHtml(serverIP) + ':' + serverPort + '</code>';
    html += '</div>';

    if (existing) {
        html += '<div style="padding:12px;background:#fef3c7;border-radius:8px;color:#92400e;font-size:13px;margin-bottom:16px">';
        html += '<i class="fas fa-exclamation-triangle"></i> 服务器列表中已存在 <strong>' + escapeHtml(existing.name) + '</strong> (' + escapeHtml(existing.address) + ':' + existing.port + ')，无需重复添加。';
        html += '</div>';
    } else {
        html += '<div class="form-group"><label>服务器名称</label><input type="text" id="postDeploySrvName" value="' + escapeHtml('VPS-' + serverIP.replace(/\./g, '-') + '-' + proto.name) + '"></div>';
        html += '<div class="form-group"><label>协议</label><select id="postDeploySrvProtocol">';
        html += '<option value="Shadowsocks"' + (serverProtocol === 'Shadowsocks' ? ' selected' : '') + '>Shadowsocks</option>';
        html += '<option value="VMess"' + (serverProtocol === 'VMess' ? ' selected' : '') + '>VMess</option>';
        html += '<option value="Trojan"' + (serverProtocol === 'Trojan' ? ' selected' : '') + '>Trojan</option>';
        html += '<option value="WireGuard"' + (serverProtocol === 'WireGuard' ? ' selected' : '') + '>WireGuard</option>';
        html += '<option value="OpenVPN"' + (serverProtocol === 'OpenVPN' ? ' selected' : '') + '>OpenVPN</option>';
        html += '</select></div>';
        html += '<div class="form-group"><label>密码（部署脚本输出的密码）</label><input type="text" id="postDeploySrvPassword" placeholder="粘贴部署脚本输出的密码或密钥"></div>';
        html += '<button class="btn btn-primary" onclick="confirmAddServerAfterDeploy(\'' + escapeHtml(serverIP) + '\',' + serverPort + ')"><i class="fas fa-plus"></i> 添加到服务器列表</button>';
    }

    html += '<button class="btn btn-secondary" onclick="closeModal()" style="margin-left:8px">关闭</button>';
    html += '</div>';

    openModal('部署完成 - ' + proto.name, html);
}

function confirmAddServerAfterDeploy(serverIP, serverPort) {
    var nameEl = document.getElementById('postDeploySrvName');
    var protoEl = document.getElementById('postDeploySrvProtocol');
    var pwdEl = document.getElementById('postDeploySrvPassword');

    if (!nameEl || !protoEl) return;

    var name = nameEl.value.trim();
    if (!name) { showToast('请输入服务器名称', 'error'); return; }

    var server = {
        id: generateId(),
        name: name,
        address: serverIP,
        port: serverPort,
        protocol: protoEl.value,
        password: pwdEl ? pwdEl.value.trim() : '',
        load: 0,
        online: true,
        createdAt: new Date().toISOString()
    };

    if (protoEl.value === 'WireGuard') {
        server.wireguard = {
            publicKey: '',
            dns: '1.1.1.1, 8.8.8.8'
        };
    }

    appData.servers.push(server);
    saveData();
    addActivity(name, '添加服务器（部署后自动配置）', 'success');
    closeModal();
    showToast('服务器「' + name + '」已添加到管理面板！', 'success');
}

// ====== 清除部署历史 ======
function clearDeployHistory() {
    if (!confirm('确定要清除所有部署历史吗？')) return;
    localStorage.setItem('vpn_deploy_history', '[]');
    renderVpnDeploy();
    showToast('部署历史已清除', 'info');
}
