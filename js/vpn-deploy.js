// ========== VPN 部署向导 ==========
// 为海外服务器生成一键部署脚本，支持 WireGuard / Shadowsocks / OpenVPN / V2Ray / IPsec

// ====== 协议定义 ======
const VPN_PROTOCOLS = [
    {
        id: 'wireguard',
        name: 'WireGuard',
        icon: 'fa-bolt',
        tag: '强烈推荐',
        tagClass: 'success',
        desc: '极简现代 VPN，内核原生支持，速度最快，配置只需几行。全平台客户端，移动端省电。',
        score: { speed: 5, security: 5, ease: 5, memory: 1 },
        minRam: '128 MB',
        port: 51820,
        pros: ['极快：代码仅 4000 行，接近网卡线速', '省电：移动端 Wi-Fi/蜂窝无缝漫游', '简单：服务端配置只需一个 ini 文件', '安全：state-of-the-art 加密（Noise + ChaCha20）'],
        cons: ['国内直连偶尔被 QoS，海外用无此问题', '不支持 TCP 伪装，无内置流量混淆'],
        setupScript: `#!/bin/bash
# ========== WireGuard 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========
# 适用于你的 RackNerd VPS (512MB RAM 完全够用)

set -e

# ---- 配置区（可修改）----
WG_PORT={{PORT}}
WG_INTERFACE=wg0
WG_NETWORK=10.66.66.0/24
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

echo "========================================"
echo "  WireGuard 一键部署"
echo "  服务器IP: $SERVER_IP"
echo "  端口: $WG_PORT"
echo "========================================"

# ---- 1. 安装 WireGuard ----
apt update && apt install -y wireguard qrencode iptables-persistent

# ---- 2. 生成密钥 ----
mkdir -p /etc/wireguard
cd /etc/wireguard
wg genkey | tee server_private.key | wg pubkey > server_public.key
wg genkey | tee client_private.key | wg pubkey > client_public.key

SERVER_PRIV=$(cat server_private.key)
SERVER_PUB=$(cat server_public.key)
CLIENT_PRIV=$(cat client_private.key)
CLIENT_PUB=$(cat client_public.key)

# ---- 3. 开启 IP 转发 ----
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
sysctl -p

# ---- 4. 服务器配置 ----
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.66.66.1/24
ListenPort = $WG_PORT
PrivateKey = $SERVER_PRIV
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
# 客户端 1
PublicKey = $CLIENT_PUB
AllowedIPs = 10.66.66.2/32
EOF

# ---- 5. 客户端配置 ----
cat > /etc/wireguard/client.conf << EOF
[Interface]
PrivateKey = $CLIENT_PRIV
Address = 10.66.66.2/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = $SERVER_PUB
Endpoint = $SERVER_IP:$WG_PORT
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

# ---- 6. 启动服务 ----
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

# ---- 7. 防火墙 ----
ufw allow $WG_PORT/udp 2>/dev/null || iptables -A INPUT -p udp --dport $WG_PORT -j ACCEPT

echo ""
echo "=============================="
echo "  WireGuard 部署完成！"
echo "=============================="
echo ""
echo "📱 客户端配置文件: /etc/wireguard/client.conf"
echo ""
echo "🔗 QR 码（手机扫一扫即可导入）:"
qrencode -t ansiutf8 < /etc/wireguard/client.conf
echo ""
cat /etc/wireguard/client.conf
echo ""
echo "📋 客户端下载: https://www.wireguard.com/install/"
echo "   导入方式: 新建隧道 → 从文件创建 → 选择 client.conf"
echo "   或扫上方 QR 码直接导入"
`
    },
    {
        id: 'shadowsocks',
        name: 'Shadowsocks-rust',
        icon: 'fa-ghost',
        tag: '推荐',
        tagClass: 'info',
        desc: '轻量级加密代理，Rust 实现速度极快。适合翻墙，但不支持全流量 VPN（需额外配置 tun2socks）。支持 SIP003 插件。',
        score: { speed: 5, security: 4, ease: 4, memory: 1 },
        minRam: '64 MB',
        port: 8388,
        pros: ['极轻量：512MB VPS 跑几十个用户没问题', '速度极快：Rust 实现，单核跑满千兆', '抗封锁强：支持 v2ray-plugin / cloak 等混淆插件', '你的管理面板已原生支持 SS 协议'],
        cons: ['本身是 SOCKS5 代理，不是全流量 VPN', '需配合 Clash Verge / V2RayN 等客户端使用', 'UDP 支持较 OpenVPN 弱'],
        setupScript: `#!/bin/bash
# ========== Shadowsocks-rust 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========
# 轻量代理，512MB VPS 绰绰有余

set -e

SS_PORT={{PORT}}
SS_PASSWORD=$(openssl rand -base64 16)
SS_METHOD="aes-256-gcm"
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

echo "========================================"
echo "  Shadowsocks-rust 一键部署"
echo "  服务器IP: $SERVER_IP"
echo "  端口: $SS_PORT"
echo "  密码: $SS_PASSWORD"
echo "  加密: $SS_METHOD"
echo "========================================"

apt update && apt install -y curl

# ---- 安装 shadowsocks-rust (官方预编译二进制) ----
SS_VERSION=$(curl -s https://api.github.com/repos/shadowsocks/shadowsocks-rust/releases/latest | grep tag_name | cut -d'"' -f4)
ARCH=$(uname -m)
case $ARCH in
    x86_64)  SS_ARCH="x86_64-unknown-linux-gnu" ;;
    aarch64) SS_ARCH="aarch64-unknown-linux-gnu" ;;
    *) echo "不支持架构: $ARCH"; exit 1 ;;
esac

cd /usr/local/bin
curl -L -o ss.tar.xz "https://github.com/shadowsocks/shadowsocks-rust/releases/download/\${SS_VERSION}/shadowsocks-\${SS_VERSION}.\${SS_ARCH}.tar.xz"
tar xf ss.tar.xz
rm ss.tar.xz

# ---- 配置文件 ----
mkdir -p /etc/shadowsocks
cat > /etc/shadowsocks/config.json << EOF
{
    "server": "0.0.0.0",
    "server_port": $SS_PORT,
    "password": "$SS_PASSWORD",
    "method": "$SS_METHOD",
    "fast_open": true,
    "mode": "tcp_and_udp",
    "timeout": 300
}
EOF

# ---- systemd 服务 ----
cat > /etc/systemd/system/shadowsocks.service << 'SERVICE'
[Unit]
Description=Shadowsocks-rust Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ssserver -c /etc/shadowsocks/config.json
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable shadowsocks
systemctl start shadowsocks

# ---- 防火墙 ----
ufw allow $SS_PORT/tcp 2>/dev/null || iptables -A INPUT -p tcp --dport $SS_PORT -j ACCEPT
ufw allow $SS_PORT/udp 2>/dev/null || iptables -A INPUT -p udp --dport $SS_PORT -j ACCEPT

# ---- 生成 SS URI ----
SS_URI=$(echo -n "$SS_METHOD:$SS_PASSWORD@$SERVER_IP:$SS_PORT" | base64 -w0)

echo ""
echo "=============================="
echo "  Shadowsocks 部署完成！"
echo "=============================="
echo ""
echo "📋 连接信息:"
echo "   地址: $SERVER_IP"
echo "   端口: $SS_PORT"
echo "   密码: $SS_PASSWORD"
echo "   加密: $SS_METHOD"
echo ""
echo "🔗 SS URI (可直接导入客户端):"
echo "   ss://$SS_URI"
echo ""
echo "📱 客户端下载:"
echo "   Windows: Clash Verge / V2RayN"
echo "   macOS: Clash Verge / Surge"
echo "   iOS: Shadowrocket / Stash"
echo "   Android: Clash Meta / v2rayNG"
`
    },
    {
        id: 'v2ray',
        name: 'V2Ray (Xray)',
        icon: 'fa-cube',
        tag: '推荐',
        tagClass: 'info',
        desc: '全能代理平台，支持 VMess/VLESS/Trojan/Shadowsocks 等多种协议。Xray 是 V2Ray 的超集，性能更好。抗封锁能力最强。',
        score: { speed: 4, security: 5, ease: 3, memory: 2 },
        minRam: '256 MB',
        port: 443,
        pros: ['协议最全：VMess/VLESS/Trojan/Shadowsocks 通吃', '抗封锁最强：XTLS 流控 + REALITY 可完美伪装', '路由灵活：可分流国内外流量', '你的管理面板已原生支持 VMess/Trojan'],
        cons: ['配置复杂度高', '服务端内存约 50-80MB', '不是全流量 VPN，需客户端配合'],
        setupScript: `#!/bin/bash
# ========== Xray (V2Ray 超集) 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========
# 512MB VPS 可运行，建议搭配 VLESS + XTLS 获得最佳性能

set -e

XRAY_PORT={{PORT}}
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

# 生成 UUID
UUID=$(cat /proc/sys/kernel/random/uuid)

echo "========================================"
echo "  Xray 一键部署 (VLESS + XTLS-Vision)"
echo "  服务器IP: $SERVER_IP"
echo "  端口: $XRAY_PORT"
echo "  UUID: $UUID"
echo "========================================"

# ---- 安装 Xray ----
apt update && apt install -y curl unzip
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install

# ---- 配置文件 ----
cat > /usr/local/etc/xray/config.json << EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [{
    "port": $XRAY_PORT,
    "protocol": "vless",
    "settings": {
      "clients": [{
        "id": "$UUID",
        "flow": "xtls-rprx-vision"
      }],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "dest": "www.microsoft.com:443",
        "serverNames": ["www.microsoft.com", "microsoft.com"],
        "privateKey": "$(xray x25519 | grep Private | awk '{print $3}')",
        "shortIds": ["$(openssl rand -hex 8)"]
      }
    }
  }],
  "outbounds": [{
    "protocol": "freedom",
    "tag": "direct"
  }]
}
EOF

# ---- 启动服务 ----
systemctl enable xray
systemctl restart xray

# ---- 获取 REALITY 公钥 ----
PUBKEY=$(grep Private /usr/local/etc/xray/config.json -A1 | tail -1 | awk '{print $2}' | xargs -I{} xray x25519 -i {} | grep Public | awk '{print $3}')
SHORTID=$(grep shortIds /usr/local/etc/xray/config.json -A1 | tail -1 | grep -oP '"[a-f0-9]+"' | tr -d '"')

# ---- 防火墙 ----
ufw allow $XRAY_PORT/tcp 2>/dev/null || iptables -A INPUT -p tcp --dport $XRAY_PORT -j ACCEPT

echo ""
echo "=============================="
echo "  Xray 部署完成！"
echo "=============================="
echo ""
echo "📋 VLESS + XTLS-Vision + REALITY 连接信息:"
echo "   协议: VLESS"
echo "   地址: $SERVER_IP"
echo "   端口: $XRAY_PORT"
echo "   UUID: $UUID"
echo "   流控: xtls-rprx-vision"
echo "   传输: tcp"
echo "   安全: reality"
echo "   公钥: $PUBKEY"
echo "   shortId: $SHORTID"
echo ""
echo "📱 客户端: V2RayN (Win) / V2Box (Mac) / Shadowrocket (iOS) / v2rayNG (Android)"
echo "   把以上信息填入客户端即可"
`
    },
    {
        id: 'openvpn',
        name: 'OpenVPN',
        icon: 'fa-lock',
        tag: '可用',
        tagClass: 'warning',
        desc: '传统 SSL VPN，兼容性最好（几乎任何设备都能连）。但速度较慢，配置复杂，移动端耗电。512MB VPS 勉强能跑。',
        score: { speed: 2, security: 4, ease: 2, memory: 3 },
        minRam: '256 MB',
        port: 1194,
        pros: ['兼容性最好：Win/Mac/Linux/iOS/Android/路由器全支持', '基于 SSL/TLS，可通过 443 端口伪装', 'UDP 和 TCP 双模式', '社区成熟，教程最多'],
        cons: ['配置极其复杂（CA/证书/DH 参数）', '速度慢：用户态 TUN 设备 + 多层加密开销', '移动端费电，切换网络重连慢', '512MB VPS 仅建议 1-2 人使用'],
        setupScript: `#!/bin/bash
# ========== OpenVPN 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========
# ⚠️ 512MB VPS 勉强可跑，建议只 1-2 个用户

set -e

OVPN_PORT={{PORT}}
OVPN_PROTO=udp
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

echo "========================================"
echo "  OpenVPN 一键部署"
echo "  服务器IP: $SERVER_IP"
echo "  端口: $OVPN_PORT/$OVPN_PROTO"
echo "========================================"

apt update && apt install -y openvpn easy-rsa curl

# ---- 配置 CA 和证书 ----
make-cadir /etc/openvpn/easy-rsa
cd /etc/openvpn/easy-rsa

# 初始化 PKI
./easyrsa init-pki
echo -e "\\n" | ./easyrsa build-ca nopass
./easyrsa gen-dh
./easyrsa build-server-full server nopass
./easyrsa build-client-full client nopass
./easyrsa gen-crl

# 生成 TLS 密钥
openvpn --genkey secret /etc/openvpn/ta.key

# ---- 服务器配置 ----
cat > /etc/openvpn/server.conf << EOF
port $OVPN_PORT
proto $OVPN_PROTO
dev tun
ca /etc/openvpn/easy-rsa/pki/ca.crt
cert /etc/openvpn/easy-rsa/pki/issued/server.crt
key /etc/openvpn/easy-rsa/pki/private/server.key
dh /etc/openvpn/easy-rsa/pki/dh.pem
tls-auth /etc/openvpn/ta.key 0
cipher AES-256-GCM
auth SHA256
server 10.8.0.0 255.255.255.0
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 1.1.1.1"
push "dhcp-option DNS 8.8.8.8"
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
status /var/log/openvpn-status.log
log /var/log/openvpn.log
verb 3
EOF

# ---- 开启 IP 转发 ----
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p

# ---- iptables NAT ----
IFACE=$(ip route | grep default | awk '{print $5}')
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o $IFACE -j MASQUERADE
iptables-save > /etc/iptables/rules.v4 2>/dev/null || true

# ---- 启动 ----
systemctl enable openvpn@server
systemctl start openvpn@server

# ---- 生成客户端配置 ----
cat > /etc/openvpn/client.ovpn << EOF
client
dev tun
proto $OVPN_PROTO
remote $SERVER_IP $OVPN_PORT
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
auth SHA256
verb 3
<ca>
$(cat /etc/openvpn/easy-rsa/pki/ca.crt)
</ca>
<cert>
$(sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' /etc/openvpn/easy-rsa/pki/issued/client.crt)
</cert>
<key>
$(cat /etc/openvpn/easy-rsa/pki/private/client.key)
</key>
<tls-auth>
$(cat /etc/openvpn/ta.key)
</tls-auth>
key-direction 1
EOF

# ---- 防火墙 ----
ufw allow $OVPN_PORT/$OVPN_PROTO 2>/dev/null || iptables -A INPUT -p $OVPN_PROTO --dport $OVPN_PORT -j ACCEPT

echo ""
echo "=============================="
echo "  OpenVPN 部署完成！"
echo "=============================="
echo ""
echo "📋 客户端配置文件: /etc/openvpn/client.ovpn"
echo "   下载后导入 OpenVPN 客户端即可"
echo ""
echo "📱 客户端下载: https://openvpn.net/client/"
`
    },
    {
        id: 'ipsec',
        name: 'IPsec/IKEv2',
        icon: 'fa-shield-halved',
        tag: '不推荐',
        tagClass: 'danger',
        desc: 'iOS/macOS/Windows 原生支持，无需安装客户端。但配置极其复杂，占用高，512MB 不够用。仅适合≥1GB VPS。',
        score: { speed: 3, security: 5, ease: 1, memory: 5 },
        minRam: '1024 MB (强烈建议)',
        port: 500,
        pros: ['系统原生支持：iOS/macOS/Windows 无需装 App', '安全等级高：IPsec 是企业级标准', '连接速度快'],
        cons: ['配置极其复杂：strongSwan + 证书体系', '资源占用高：512MB 跑不动', 'UDP 500/4500 端口可能被运营商封', '国内直连极易被 QoS'],
        setupScript: `#!/bin/bash
# ========== IPsec/IKEv2 一键部署脚本 (Ubuntu 20.04+/Debian 11+) ==========
# ⚠️⚠️⚠️ 严重警告：此协议需要至少 1GB 内存！
# 你的 VPS 只有 512MB，运行 IPsec 可能导致 OOM 被杀！
# 强烈建议改用 WireGuard！

set -e

SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ip.sb 2>/dev/null || echo "YOUR_SERVER_IP")

echo "========================================"
echo "  ⚠️  警告：你的 VPS 可能内存不足！"
echo "  建议改为使用 WireGuard"
echo "  按 Ctrl+C 取消，等待 10 秒继续..."
echo "========================================"
sleep 10

VPN_USER="vpnuser"
VPN_PASSWORD=$(openssl rand -base64 12)

apt update && apt install -y strongswan strongswan-pki libcharon-extra-plugins

# ---- 生成证书 ----
mkdir -p /etc/ipsec.d/private /etc/ipsec.d/certs /etc/ipsec.d/cacerts

pki --gen --type rsa --size 2048 --outform pem > /etc/ipsec.d/private/ca-key.pem
pki --self --ca --lifetime 3650 --in /etc/ipsec.d/private/ca-key.pem \\
    --dn "CN=VPN CA" --outform pem > /etc/ipsec.d/cacerts/ca-cert.pem

pki --gen --type rsa --size 2048 --outform pem > /etc/ipsec.d/private/server-key.pem
pki --pub --in /etc/ipsec.d/private/server-key.pem | \\
    pki --issue --lifetime 1825 --cacert /etc/ipsec.d/cacerts/ca-cert.pem \\
    --cakey /etc/ipsec.d/private/ca-key.pem \\
    --dn "CN=$SERVER_IP" --san $SERVER_IP --flag serverAuth --flag ikeIntermediate \\
    --outform pem > /etc/ipsec.d/certs/server-cert.pem

# ---- strongSwan 配置 ----
cat > /etc/ipsec.conf << EOF
config setup
    charondebug="ike 2, knl 2, cfg 2"

conn ikev2-vpn
    auto=add
    compress=no
    type=tunnel
    keyexchange=ikev2
    fragmentation=yes
    forceencaps=yes
    dpdaction=clear
    dpddelay=300s
    rekey=no
    left=%any
    leftid=@$SERVER_IP
    leftcert=server-cert.pem
    leftsendcert=always
    leftsubnet=0.0.0.0/0
    right=%any
    rightid=%any
    rightauth=eap-mschapv2
    rightsourceip=10.10.10.0/24
    rightdns=1.1.1.1,8.8.8.8
    rightsendcert=never
    eap_identity=%identity
EOF

cat > /etc/ipsec.secrets << EOF
: RSA "server-key.pem"
$VPN_USER : EAP "$VPN_PASSWORD"
EOF

# ---- 防火墙 & 转发 ----
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p
IFACE=$(ip route | grep default | awk '{print $5}')
iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -o $IFACE -j MASQUERADE

ufw allow 500/udp 2>/dev/null || iptables -A INPUT -p udp --dport 500 -j ACCEPT
ufw allow 4500/udp 2>/dev/null || iptables -A INPUT -p udp --dport 4500 -j ACCEPT

systemctl enable strongswan
systemctl restart strongswan

echo ""
echo "=============================="
echo "  IPsec/IKEv2 部署完成！"
echo "=============================="
echo ""
echo "⚠️  提醒：512MB 内存运行 IPsec 不稳定，建议改用 WireGuard"
echo ""
echo "📋 连接信息:"
echo "   服务器: $SERVER_IP"
echo "   用户名: $VPN_USER"
echo "   密码: $VPN_PASSWORD"
echo "   类型: IKEv2"
echo ""
echo "📱 连接方式:"
echo "   Win/macOS/iOS: 系统设置 → VPN → 添加 IKEv2 → 填入以上信息"
echo "   Android: 下载 strongSwan 客户端"
`
    }
];

// ====== 页面渲染 ======
function renderVpnDeploy() {
    var page = document.getElementById('page-deploy');
    if (!page) return;

    // 把用户输入的服务器信息存到全局，供脚本生成使用
    window._deployServerIP = window._deployServerIP || '204.152.217.105';
    window._deployServerPort = window._deployServerPort || '';

    var html = '';

    // 服务器信息卡片
    html += '<div class="card deploy-server-card">';
    html += '<h3><i class="fas fa-cloud"></i> 目标服务器</h3>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">';
    html += '<div class="form-group" style="margin:0"><label>服务器 IP</label><input type="text" id="deployServerIP" value="' + escapeHtml(window._deployServerIP) + '" style="width:200px;font-family:monospace" onchange="updateSshCommand()"></div>';
    html += '<div class="form-group" style="margin:0"><label>SSH 端口</label><input type="text" id="deployServerSSH" value="22" style="width:80px" onchange="updateSshCommand()"></div>';
    html += '<div class="form-group" style="margin:0"><label>SSH 用户</label><input type="text" id="deployServerUser" value="root" style="width:100px" onchange="updateSshCommand()"></div>';
    html += '</div>';
    // SSH 连接命令
    html += '<div style="background:#1e293b;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px">';
    html += '<code id="sshCommandDisplay" style="color:#4ade80;font-size:14px;font-family:Consolas,Monaco,monospace;flex:1">ssh root@' + escapeHtml(window._deployServerIP) + '</code>';
    html += '<button class="btn btn-primary btn-sm" onclick="copySshCommand()"><i class="fas fa-copy"></i> 复制</button>';
    html += '</div>';
    // SSH 使用提示
    html += '<details style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">';
    html += '<summary style="cursor:pointer;color:var(--primary);font-weight:500"><i class="fas fa-question-circle"></i> 不知道怎么 SSH？点这里看步骤</summary>';
    html += '<div style="margin-top:8px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);line-height:1.8">';
    html += '<strong>① 获取 root 密码：</strong>打开 RackNerd NerdVM 面板 → 找到 Root Password 设置<br>';
    html += '<strong>② 打开终端：</strong>Windows 按 <kbd>Win+R</kbd> 输入 <code>cmd</code> 回车<br>';
    html += '<strong>③ 连接：</strong>复制上方绿色命令 → 粘贴到终端 → 回车<br>';
    html += '<strong>④ 输入密码：</strong>粘贴 root 密码（输入时不显示字符，正常）→ 回车<br>';
    html += '<strong>⑤ 部署：</strong>连上后，点下方任一协议的「一键复制脚本」→ 粘贴到终端 → 回车执行</div>';
    html += '</details>';
    html += '</div>';

    // 协议卡片
    html += '<div class="deploy-grid">';

    VPN_PROTOCOLS.forEach(function(proto) {
        var stars = '';
        for (var i = 0; i < 5; i++) {
            stars += '<span class="star' + (i < proto.score.speed ? ' filled' : '') + '">★</span>';
        }

        html += '<div class="deploy-card" id="deploy-card-' + proto.id + '">';
        // 头部
        html += '<div class="deploy-card-header">';
        html += '<div class="deploy-card-icon"><i class="fas ' + proto.icon + '"></i></div>';
        html += '<div class="deploy-card-title">';
        html += '<h4>' + proto.name + '</h4>';
        html += '<span class="deploy-tag tag-' + proto.tagClass + '">' + proto.tag + '</span>';
        html += '</div></div>';

        // 描述
        html += '<p class="deploy-card-desc">' + proto.desc + '</p>';

        // 评分
        html += '<div class="deploy-scores">';
        html += '<div class="score-row"><span>速度</span><span class="score-stars">' + renderStars(proto.score.speed) + '</span></div>';
        html += '<div class="score-row"><span>安全</span><span class="score-stars">' + renderStars(proto.score.security) + '</span></div>';
        html += '<div class="score-row"><span>易用</span><span class="score-stars">' + renderStars(proto.score.ease) + '</span></div>';
        html += '<div class="score-row"><span>资源占用</span><span class="score-stars">' + renderMemStars(proto.score.memory) + '</span></div>';
        html += '</div>';

        // 最低内存
        html += '<div class="deploy-ram"><i class="fas fa-microchip"></i> 最低内存: <strong>' + proto.minRam + '</strong></div>';

        // 默认端口
        html += '<div class="deploy-port">默认端口: <code>' + proto.port + '</code></div>';

        // 优缺点
        html += '<div class="deploy-pros-cons">';
        html += '<div class="deploy-pros"><strong>✅ 优点</strong><ul>';
        proto.pros.forEach(function(p) { html += '<li>' + p + '</li>'; });
        html += '</ul></div>';
        html += '<div class="deploy-cons"><strong>⚠️ 注意</strong><ul>';
        proto.cons.forEach(function(c) { html += '<li>' + c + '</li>'; });
        html += '</ul></div>';
        html += '</div>';

        // 操作按钮
        html += '<div class="deploy-actions">';
        html += '<button class="btn btn-primary" onclick="showDeployScript(\'' + proto.id + '\')"><i class="fas fa-terminal"></i> 查看部署脚本</button>';
        html += '<button class="btn btn-secondary" onclick="copyDeployScript(\'' + proto.id + '\')"><i class="fas fa-copy"></i> 一键复制脚本</button>';
        html += '</div>';

        html += '</div>';
    });

    html += '</div>';
    page.innerHTML = html;
}

function renderStars(count) {
    var s = '';
    for (var i = 0; i < 5; i++) {
        s += '<i class="fas fa-star star' + (i < count ? ' filled' : ' empty') + '"></i>';
    }
    return s;
}

function renderMemStars(count) {
    // 资源占用：星星越少越好（1=极低占用, 5=极高占用）
    var s = '';
    for (var i = 0; i < 5; i++) {
        if (i < count) {
            s += '<i class="fas fa-circle mem-dot filled"></i>';
        } else {
            s += '<i class="fas fa-circle mem-dot empty"></i>';
        }
    }
    return s;
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

// ====== 脚本生成与展示 ======
function getDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return '';

    var ip = document.getElementById('deployServerIP');
    var serverIP = ip ? ip.value.trim() : 'YOUR_SERVER_IP';
    
    // 如果端口输入框存在，使用自定义端口
    var customPort = window._deployServerPort;
    var port = customPort || proto.port;

    var script = proto.setupScript;
    script = script.replace(/\{\{PORT\}\}/g, String(port));
    
    return script;
}

function showDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

    var script = getDeployScript(protocolId);

    var html = '<div class="form-group">';
    html += '<label>协议</label><div><strong>' + proto.name + '</strong> <span class="deploy-tag tag-' + proto.tagClass + '">' + proto.tag + '</span></div>';
    html += '</div>';

    html += '<div class="form-group">';
    html += '<label>端口</label>';
    html += '<div style="display:flex;gap:8px">';
    html += '<input type="number" id="deployScriptPort" value="' + proto.port + '" style="width:120px" onchange="window._deployServerPort=this.value">';
    html += '</div></div>';

    html += '<div class="form-group">';
    html += '<label>部署脚本 (SSH 到服务器后粘贴执行)</label>';
    html += '<textarea readonly id="deployScriptContent" style="width:100%;height:400px;font-family:Consolas,Monaco,monospace;font-size:12px;background:#1e293b;color:#e2e8f0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;resize:vertical">' + escapeHtml(script) + '</textarea>';
    html += '</div>';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary" onclick="copyDeployScriptContent()"><i class="fas fa-copy"></i> 复制脚本</button>';
    html += '<button class="btn btn-secondary" onclick="downloadDeployScript(\'' + protocolId + '\')"><i class="fas fa-download"></i> 下载 .sh 文件</button>';
    html += '</div>';

    html += '<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:var(--radius-sm);font-size:12px;color:#92400e">';
    html += '<strong><i class="fas fa-lightbulb"></i> 使用步骤：</strong><br>';
    html += '1. 复制上方脚本<br>';
    html += '2. SSH 连接到你的服务器: <code>ssh root@' + escapeHtml(document.getElementById('deployServerIP') ? document.getElementById('deployServerIP').value : 'YOUR_SERVER_IP') + '</code><br>';
    html += '3. 粘贴脚本 → 回车执行<br>';
    html += '4. 等待完成，记下输出的连接信息';
    html += '</div>';

    window._currentDeployProtocol = protocolId;
    openModal('部署: ' + proto.name, html);
}

function copyDeployScript(protocolId) {
    var script = getDeployScript(protocolId);
    navigator.clipboard.writeText(script).then(function() {
        showToast('部署脚本已复制！SSH 到服务器粘贴执行即可', 'success');
        addAuditLog('复制部署脚本', '协议: ' + protocolId);
    }).catch(function() {
        showToast('复制失败，请手动选择', 'error');
    });
}

function copyDeployScriptContent() {
    var ta = document.getElementById('deployScriptContent');
    if (!ta) return;
    navigator.clipboard.writeText(ta.value).then(function() {
        showToast('脚本已复制到剪贴板', 'success');
    }).catch(function() {
        showToast('复制失败，请手动选择文本', 'error');
    });
}

function downloadDeployScript(protocolId) {
    var proto = VPN_PROTOCOLS.find(function(p) { return p.id === protocolId; });
    if (!proto) return;

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
