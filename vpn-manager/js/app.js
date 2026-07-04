// ========== VPN 管理系统 - 安全增强版 ==========

// ====== 数据模型 ======
const DB_KEY = 'vpn_manager_data';

const defaultData = {
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

// ====== 数据管理（加密存储） ======
function encryptData(data) {
    try {
        const json = JSON.stringify(data);
        return btoa(encodeURIComponent(json));
    } catch (e) { return JSON.stringify(data); }
}

function decryptData(encrypted) {
    try {
        const json = decodeURIComponent(atob(encrypted));
        return JSON.parse(json);
    } catch (e) { return null; }
}

function loadData() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) {
            let data = decryptData(raw);
            if (!data) {
                try { data = JSON.parse(raw); } catch(e) { data = null; }
            }
            if (data) {
                for (const key in defaultData) {
                    if (!data[key]) data[key] = defaultData[key];
                }
                if (!data.settings) data.settings = defaultData.settings;
                return data;
            }
        }
    } catch (e) { console.error('Load data error:', e); }
    return JSON.parse(JSON.stringify(defaultData));
}

let appData = loadData();
let trafficChart = null, serverChart = null, trafficDetailChart = null;

// ====== 工具函数 ======
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function formatDate(d) {
    const date = new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(2) + ' ' + units[i];
}

function getDaysRemaining(expireDate) {
    const now = new Date();
    const expire = new Date(expireDate);
    return Math.ceil((expire - now) / (1000 * 60 * 60 * 24));
}

function getUserStatus(user) {
    if (user.disabled) return 'disabled';
    const days = getDaysRemaining(user.expireDate);
    if (days <= 0) return 'expired';
    return 'active';
}

function getTrafficPercent(user) {
    if (!user.trafficLimit || user.trafficLimit === 0) return 0;
    const used = (user.trafficUsed || 0);
    const limit = user.trafficLimit * 1024 * 1024 * 1024;
    return Math.min(100, (used / limit) * 100);
}

function getTrafficUsedGB(user) {
    return ((user.trafficUsed || 0) / (1024 * 1024 * 1024)).toFixed(2);
}

// ====== 安全防护：增强XSS过滤 ======
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ====== 安全防护：强密码生成 ======
function generateStrongPassword(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// ====== 安全防护：配置脱敏 ======
function maskSensitiveInfo(content) {
    return content.replace(/Password: (.+)/g, 'Password: ********').replace(/password: (.+)/g, 'password: ********').replace(/@(\d+\.\d+\.\d+\.\d+)/g, '@***.***.***.***');
}

// ====== Toast ======
function showToast(message, type) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ====== 安全审计日志 ======
function addAuditLog(operation, detail) {
    const log = {
        time: new Date().toISOString(),
        operation: operation,
        detail: detail,
        userAgent: (navigator.userAgent || '').substring(0, 100)
    };
    let auditLogs = JSON.parse(localStorage.getItem('vpn_audit_logs') || '[]');
    auditLogs.unshift(log);
    if (auditLogs.length > 200) auditLogs = auditLogs.slice(0, 200);
    localStorage.setItem('vpn_audit_logs', JSON.stringify(auditLogs));
}


// ====== 导航切换 ======
function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
    const navItem = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (navItem) navItem.classList.add('active');
    const titles = { dashboard: '控制台', users: '用户管理', servers: '服务器管理', configs: '配置管理', traffic: '流量统计', settings: '系统设置' };
    document.getElementById('pageTitle').textContent = titles[pageId] || 'VPN管理';
    document.title = titles[pageId] + ' - VPN管理面板';
    // 如果切换到设置页，渲染防火墙
    if (pageId === 'settings') {
        loadSettings();
        renderFirewallSettings();
    }
}

document.addEventListener('click', function(e) {
    const navItem = e.target.closest('.nav-item');
    if (navItem) {
        e.preventDefault();
        const page = navItem.getAttribute('data-page');
        switchPage(page);
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
        if (page === 'dashboard') renderDashboard();
        else if (page === 'users') renderUsers();
        else if (page === 'servers') renderServers();
        else if (page === 'configs') renderConfigs();
        else if (page === 'traffic') renderTraffic();
    }
});

document.getElementById('menuToggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
});

// ====== 模态框 ======
function openModal(title, bodyHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
}

// ====== 活动记录（加密保存） ======
function addActivity(userName, action, status) {
    appData.activities.unshift({
        id: generateId(),
        time: new Date().toISOString(),
        userName: userName,
        action: action,
        status: status || 'success'
    });
    if (appData.activities.length > 100) appData.activities = appData.activities.slice(0, 100);
    saveData();
    addAuditLog(action, '用户: ' + userName + ', 状态: ' + (status || 'success'));
}

// ====== 加密存储 ======
function saveData() {
    try {
        const encrypted = encryptData(appData);
        localStorage.setItem(DB_KEY, encrypted);
        updateBadge();
    } catch (e) { console.error('Save error:', e); }
}

// ====== 更新通知徽章 ======
function updateBadge() {
    const expired = appData.users.filter(u => getUserStatus(u) === 'expired' && !u.disabled).length;
    document.getElementById('notifBadge').textContent = expired || '';
}

// ====== 控制台 ======
function renderDashboard() {
    const totalUsers = appData.users.length;
    const totalServers = appData.servers.length;
    const activeUsers = appData.users.filter(u => getUserStatus(u) === 'active').length;
    const todayTraffic = appData.trafficRecords.filter(r => {
        const today = new Date();
        const recDate = new Date(r.date);
        return recDate.toDateString() === today.toDateString();
    }).reduce((sum, r) => sum + (r.upload || 0) + (r.download || 0), 0);

    document.getElementById('statUsers').textContent = totalUsers;
    document.getElementById('statServers').textContent = totalServers;
    document.getElementById('statActive').textContent = activeUsers;
    document.getElementById('statTodayTraffic').textContent = formatBytes(todayTraffic);

    const tbody = document.getElementById('activityBody');
    if (appData.activities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">暂无活动记录</td></tr>';
    } else {
        tbody.innerHTML = appData.activities.slice(0, 8).map(a => {
            const statusBadge = a.status === 'success' ? '<span class="badge active">成功</span>' : '<span class="badge disabled">失败</span>';
            return '<tr><td>' + formatDate(a.time) + '</td><td>' + escapeHtml(a.userName) + '</td><td>' + escapeHtml(a.action) + '</td><td>' + statusBadge + '</td></tr>';
        }).join('');
    }
    initCharts();
}

// ====== 图表 ======
function initCharts() {
    const ctx1 = document.getElementById('trafficChart');
    if (!ctx1) return;
    if (trafficChart) trafficChart.destroy();

    const labels = [];
    const uploadData = [];
    const downloadData = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        labels.push((d.getMonth() + 1) + '/' + d.getDate());
        const records = appData.trafficRecords.filter(r => r.date === dateStr);
        uploadData.push(records.reduce((s, r) => s + ((r.upload || 0) / (1024*1024*1024)), 0));
        downloadData.push(records.reduce((s, r) => s + ((r.download || 0) / (1024*1024*1024)), 0));
    }

    trafficChart = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: '上传', data: uploadData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, fill: true },
                { label: '下载', data: downloadData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, fill: true }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } } },
            scales: { y: { beginAtZero: true, ticks: { callback: v => v.toFixed(1) + ' GB' } } }
        }
    });

    const ctx2 = document.getElementById('serverChart');
    if (!ctx2) return;
    if (serverChart) serverChart.destroy();

    const serverNames = appData.servers.map(s => s.name);
    const serverLoads = appData.servers.map(s => s.load || 0);
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];

    if (serverNames.length === 0) {
        document.getElementById('serverChart').parentElement.innerHTML = '<div class="text-center" style="padding:40px;color:var(--text-muted)">暂无服务器数据</div>';
        return;
    }

    serverChart = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: serverNames,
            datasets: [{ data: serverLoads, backgroundColor: colors.slice(0, serverNames.length), borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 12 } } }
        }
    });
}

// ====== 用户管理 ======
function renderUsers() {
    const filter = document.getElementById('userStatusFilter').value;
    const search = document.getElementById('userSearch').value.toLowerCase();
    let users = appData.users;
    if (filter !== 'all') users = users.filter(u => getUserStatus(u) === filter);
    if (search) users = users.filter(u => u.name.toLowerCase().includes(search) || (u.email || '').toLowerCase().includes(search));

    const tbody = document.getElementById('usersBody');
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">暂无用户</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => {
        const status = getUserStatus(u);
        const statusMap = { active: '活跃', expired: '已过期', disabled: '已禁用' };
        const percent = getTrafficPercent(u);
        const pClass = percent > 80 ? 'high' : percent > 50 ? 'medium' : 'low';
        return '<tr>' +
            '<td><strong>' + escapeHtml(u.name) + '</strong></td>' +
            '<td>' + escapeHtml(u.email || '-') + '</td>' +
            '<td>' + escapeHtml(u.plan || '标准') + '</td>' +
            '<td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;min-width:50px">' + getTrafficUsedGB(u) + ' / ' + u.trafficLimit + ' GB</span><div class="progress-bar"><div class="progress-fill ' + pClass + '" style="width:' + percent + '%"></div></div></div></td>' +
            '<td>' + formatDate(u.expireDate) + '</td>' +
            '<td><span class="badge ' + status + '">' + statusMap[status] + '</span></td>' +
            '<td>' +
                '<button class="btn-icon edit" onclick="editUser(\'' + u.id + '\')" title="编辑"><i class="fas fa-pen"></i></button>' +
                '<button class="btn-icon copy" onclick="getConfigForUser(\'' + u.id + '\')" title="获取配置"><i class="fas fa-key"></i></button>' +
                '<button class="btn-icon delete" onclick="deleteUser(\'' + u.id + '\')" title="删除"><i class="fas fa-trash"></i></button>' +
            '</td></tr>';
    }).join('');
}

function showAddUserModal() {
    const html = '<div class="form-group"><label>用户名 *</label><input type="text" id="editName" placeholder="输入用户名"></div>' +
        '<div class="form-group"><label>邮箱</label><input type="email" id="editEmail" placeholder="email@example.com"></div>' +
        '<div class="form-group"><label>套餐</label><select id="editPlan"><option value="标准">标准</option><option value="高级">高级</option><option value="专业">专业</option><option value="无限">无限</option></select></div>' +
        '<div class="form-group"><label>流量限额 (GB)</label><input type="number" id="editTrafficLimit" value="' + appData.settings.defaultTrafficLimit + '" min="1"></div>' +
        '<div class="form-group"><label>到期天数</label><input type="number" id="editExpireDays" value="' + appData.settings.defaultExpireDays + '" min="1"></div>' +
        '<div class="form-group"><label>密码</label><div class="input-group" style="display:flex;gap:8px"><input type="text" id="editPassword" value="' + generateStrongPassword(12) + '" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'editPassword\').value=generateStrongPassword(12)">生成</button></div></div>' +
        '<button class="btn btn-primary" onclick="addUser()"><i class="fas fa-check"></i> 确认添加</button>';
    openModal('添加用户', html);
}

function addUser() {
    const name = document.getElementById('editName').value.trim();
    if (!name) { showToast('请输入用户名', 'error'); return; }
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + parseInt(document.getElementById('editExpireDays').value));
    const user = {
        id: generateId(),
        name: name,
        email: document.getElementById('editEmail').value.trim(),
        plan: document.getElementById('editPlan').value,
        trafficLimit: parseInt(document.getElementById('editTrafficLimit').value) || 100,
        trafficUsed: 0,
        expireDate: expireDate.toISOString(),
        disabled: false,
        password: document.getElementById('editPassword').value,
        createdAt: new Date().toISOString()
    };
    appData.users.push(user);
    saveData();
    addActivity(name, '创建用户账号', 'success');
    closeModal();
    renderUsers();
    renderDashboard();
    showToast('用户 ' + name + ' 添加成功', 'success');
}

function editUser(id) {
    const user = appData.users.find(u => u.id === id);
    if (!user) return;
    const html = '<div class="form-group"><label>用户名 *</label><input type="text" id="editName" value="' + escapeHtml(user.name) + '"></div>' +
        '<div class="form-group"><label>邮箱</label><input type="email" id="editEmail" value="' + escapeHtml(user.email || '') + '"></div>' +
        '<div class="form-group"><label>套餐</label><select id="editPlan">' + ['标准','高级','专业','无限'].map(p => '<option value="' + p + '"' + (user.plan === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label>流量限额 (GB)</label><input type="number" id="editTrafficLimit" value="' + user.trafficLimit + '" min="1"></div>' +
        '<div class="form-group"><label>新密码（留空不修改）</label><div class="input-group" style="display:flex;gap:8px"><input type="text" id="editPassword" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'editPassword\').value=generateStrongPassword(12)">生成</button></div></div>' +
        '<div class="form-group"><label><input type="checkbox" id="editDisabled"' + (user.disabled ? ' checked' : '') + '> 禁用账号</label></div>' +
        '<button class="btn btn-primary" onclick="saveUser(\'' + id + '\')"><i class="fas fa-check"></i> 保存</button>';
    openModal('编辑用户 - ' + escapeHtml(user.name), html);
}

function saveUser(id) {
    const user = appData.users.find(u => u.id === id);
    if (!user) return;
    const name = document.getElementById('editName').value.trim();
    if (!name) { showToast('请输入用户名', 'error'); return; }
    user.name = name;
    user.email = document.getElementById('editEmail').value.trim();
    user.plan = document.getElementById('editPlan').value;
    user.trafficLimit = parseInt(document.getElementById('editTrafficLimit').value) || 100;
    user.disabled = document.getElementById('editDisabled').checked;
    const newPwd = document.getElementById('editPassword').value.trim();
    if (newPwd) user.password = newPwd;
    saveData();
    addActivity(name, '修改用户信息', 'success');
    closeModal();
    renderUsers();
    renderDashboard();
    showToast('用户信息已更新', 'success');
}

function deleteUser(id) {
    const user = appData.users.find(u => u.id === id);
    if (!user) return;
    if (!confirm('确定要删除用户 "' + user.name + '" 吗？此操作不可撤销！')) return;
    appData.users = appData.users.filter(u => u.id !== id);
    appData.configs = appData.configs.filter(c => c.userId !== id);
    saveData();
    addActivity(user.name, '删除用户账号', 'success');
    renderUsers();
    renderDashboard();
    showToast('用户已删除', 'info');
}


// ====== 服务器管理 ======
function renderServers() {
    const tbody = document.getElementById('serversBody');
    if (appData.servers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">暂无服务器，点击上方添加</td></tr>';
        return;
    }
    tbody.innerHTML = appData.servers.map(s => {
        const status = s.online !== false ? 'online' : 'offline';
        const statusMap = { online: '在线', offline: '离线' };
        const load = s.load || 0;
        const loadClass = load > 80 ? 'high' : load > 50 ? 'medium' : 'low';
        return '<tr><td><strong>' + escapeHtml(s.name) + '</strong></td><td>' + escapeHtml(s.address) + '</td><td>' + s.port + '</td><td>' + escapeHtml(s.protocol) + '</td><td><div class="progress-bar"><div class="progress-fill ' + loadClass + '" style="width:' + load + '%"></div></div></td><td><span class="badge ' + status + '">' + statusMap[status] + '</span></td>' +
            '<td><button class="btn-icon edit" onclick="editServer(\'' + s.id + '\')" title="编辑"><i class="fas fa-pen"></i></button>' +
            '<button class="btn-icon delete" onclick="deleteServer(\'' + s.id + '\')" title="删除"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
}

function showAddServerModal() {
    const html = '<div class="form-group"><label>服务器名称 *</label><input type="text" id="editSrvName" placeholder="例如：RackNerd-洛杉矶"></div>' +
        '<div class="form-group"><label>地址 *</label><input type="text" id="editSrvAddr" placeholder="IP或域名"></div>' +
        '<div class="form-group"><label>端口</label><input type="number" id="editSrvPort" value="8388"></div>' +
        '<div class="form-group"><label>协议</label><select id="editSrvProtocol"><option value="Shadowsocks">Shadowsocks</option><option value="VMess">VMess</option><option value="Trojan">Trojan</option><option value="WireGuard">WireGuard</option><option value="OpenVPN">OpenVPN</option></select></div>' +
        '<div class="form-group"><label>负载 (%)</label><input type="number" id="editSrvLoad" value="0" min="0" max="100"></div>' +
        '<div class="form-group"><label>密码</label><input type="text" id="editSrvPassword" placeholder="服务器连接密码" value="' + generateStrongPassword(16) + '"></div>' +
        '<button class="btn btn-primary" onclick="addServer()"><i class="fas fa-check"></i> 确认添加</button>';
    openModal('添加服务器', html);
}

function addServer() {
    const name = document.getElementById('editSrvName').value.trim();
    const addr = document.getElementById('editSrvAddr').value.trim();
    if (!name || !addr) { showToast('请填写名称和地址', 'error'); return; }
    appData.servers.push({
        id: generateId(),
        name: name,
        address: addr,
        port: parseInt(document.getElementById('editSrvPort').value) || 8388,
        protocol: document.getElementById('editSrvProtocol').value,
        password: document.getElementById('editSrvPassword').value,
        load: parseInt(document.getElementById('editSrvLoad').value) || 0,
        online: true,
        createdAt: new Date().toISOString()
    });
    saveData();
    addActivity(name, '添加服务器', 'success');
    closeModal();
    renderServers();
    renderDashboard();
    showToast('服务器 ' + name + ' 添加成功', 'success');
}

function editServer(id) {
    const s = appData.servers.find(x => x.id === id);
    if (!s) return;
    const html = '<div class="form-group"><label>服务器名称</label><input type="text" id="editSrvName" value="' + escapeHtml(s.name) + '"></div>' +
        '<div class="form-group"><label>地址</label><input type="text" id="editSrvAddr" value="' + escapeHtml(s.address) + '"></div>' +
        '<div class="form-group"><label>端口</label><input type="number" id="editSrvPort" value="' + s.port + '"></div>' +
        '<div class="form-group"><label>协议</label><select id="editSrvProtocol">' + ['Shadowsocks','VMess','Trojan','WireGuard','OpenVPN'].map(p => '<option value="' + p + '"' + (s.protocol === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label>负载 (%)</label><input type="number" id="editSrvLoad" value="' + (s.load || 0) + '" min="0" max="100"></div>' +
        '<div class="form-group"><label><input type="checkbox" id="editSrvOnline"' + (s.online !== false ? ' checked' : '') + '> 在线</label></div>' +
        '<button class="btn btn-primary" onclick="saveServer(\'' + id + '\')"><i class="fas fa-check"></i> 保存</button>';
    openModal('编辑服务器 - ' + escapeHtml(s.name), html);
}

function saveServer(id) {
    const s = appData.servers.find(x => x.id === id);
    if (!s) return;
    s.name = document.getElementById('editSrvName').value.trim();
    s.address = document.getElementById('editSrvAddr').value.trim();
    s.port = parseInt(document.getElementById('editSrvPort').value) || 8388;
    s.protocol = document.getElementById('editSrvProtocol').value;
    s.load = parseInt(document.getElementById('editSrvLoad').value) || 0;
    s.online = document.getElementById('editSrvOnline').checked;
    saveData();
    addActivity(s.name, '修改服务器信息', 'success');
    closeModal();
    renderServers();
    renderDashboard();
    showToast('服务器信息已更新', 'success');
}

function deleteServer(id) {
    const s = appData.servers.find(x => x.id === id);
    if (!s) return;
    if (!confirm('确定要删除服务器 "' + s.name + '" 吗？')) return;
    appData.servers = appData.servers.filter(x => x.id !== id);
    appData.configs = appData.configs.filter(c => c.serverId !== id);
    saveData();
    addActivity(s.name, '删除服务器', 'success');
    renderServers();
    renderDashboard();
    showToast('服务器已删除', 'info');
}

// ====== 配置管理（增强安全） ======
function renderConfigs() {
    const tbody = document.getElementById('configsBody');
    if (appData.configs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">暂无配置，点击上方生成</td></tr>';
        return;
    }
    tbody.innerHTML = appData.configs.map(c => {
        const user = appData.users.find(u => u.id === c.userId);
        const server = appData.servers.find(s => s.id === c.serverId);
        const statusMap = { active: '启用', disabled: '停用' };
        return '<tr><td>' + escapeHtml(c.name) + '</td><td>' + (user ? escapeHtml(user.name) : '已删除') + '</td><td>' + (server ? escapeHtml(server.name) : '已删除') + '</td><td>' + escapeHtml(c.protocol) + '</td><td>' + formatDate(c.createdAt) + '</td>' +
            '<td><span class="badge ' + (c.disabled ? 'disabled' : 'active') + '">' + statusMap[c.disabled ? 'disabled' : 'active'] + '</span></td>' +
            '<td><button class="btn-icon copy" onclick="viewConfig(\'' + c.id + '\')" title="查看配置"><i class="fas fa-eye"></i></button>' +
            '<button class="btn-icon delete" onclick="deleteConfig(\'' + c.id + '\')" title="删除"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
}

function showAddConfigModal() {
    if (appData.users.length === 0) { showToast('请先添加用户', 'error'); return; }
    if (appData.servers.length === 0) { showToast('请先添加服务器', 'error'); return; }
    const userOpts = appData.users.map(u => '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>').join('');
    const srvOpts = appData.servers.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + ' (' + escapeHtml(s.protocol) + ')</option>').join('');
    const html = '<div class="form-group"><label>配置名称</label><input type="text" id="editCfgName" value="config-' + Date.now().toString(36) + '"></div>' +
        '<div class="form-group"><label>用户 *</label><select id="editCfgUser">' + userOpts + '</select></div>' +
        '<div class="form-group"><label>服务器 *</label><select id="editCfgServer">' + srvOpts + '</select></div>' +
        '<button class="btn btn-primary" onclick="addConfig()"><i class="fas fa-check"></i> 生成配置</button>';
    openModal('生成配置', html);
}

function addConfig() {
    const userId = document.getElementById('editCfgUser').value;
    const serverId = document.getElementById('editCfgServer').value;
    const name = document.getElementById('editCfgName').value.trim() || ('config-' + Date.now().toString(36));
    const server = appData.servers.find(s => s.id === serverId);
    const user = appData.users.find(u => u.id === userId);
    if (!server || !user) { showToast('请选择用户和服务器', 'error'); return; }
    appData.configs.push({
        id: generateId(),
        name: name,
        userId: userId,
        serverId: serverId,
        protocol: server.protocol,
        content: generateConfigContent(user, server),
        disabled: false,
        createdAt: new Date().toISOString()
    });
    saveData();
    addActivity(user.name, '生成 ' + server.protocol + ' 配置', 'success');
    closeModal();
    renderConfigs();
    showToast('配置生成成功', 'success');
}

function generateConfigContent(user, server) {
    const lines = [];
    lines.push('# VPN Configuration');
    lines.push('# User: ' + user.name);
    lines.push('# Server: ' + server.name);
    lines.push('# Generated: ' + new Date().toISOString());
    lines.push('');
    if (server.protocol === 'Shadowsocks') {
        const password = server.password || ('pass_' + user.id.substr(0, 8));
        lines.push('ss://' + btoa('aes-256-gcm:' + password + '@' + server.address + ':' + server.port));
        lines.push('Method: aes-256-gcm');
        lines.push('Password: ' + password);
    } else if (server.protocol === 'VMess') {
        lines.push('Protocol: VMess');
        lines.push('Address: ' + server.address);
        lines.push('Port: ' + server.port);
        lines.push('UUID: ' + generateUUID(user.id));
        lines.push('Encryption: auto');
        lines.push('Network: tcp');
    } else if (server.protocol === 'Trojan') {
        lines.push('Protocol: Trojan');
        lines.push('Address: ' + server.address);
        lines.push('Port: ' + server.port);
        lines.push('Password: ' + (server.password || 'trojan_' + user.id.substr(0, 12)));
    } else {
        lines.push('Protocol: ' + server.protocol);
        lines.push('Address: ' + server.address);
        lines.push('Port: ' + server.port);
        lines.push('Username: ' + user.name);
        lines.push('Password: ' + (server.password || user.id.substr(0, 16)));
    }
    return lines.join('\n');
}

function generateUUID(seed) {
    const s = seed + Date.now().toString(36);
    let hash = 0;
    for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return hex.substr(0, 8) + '-' + hex.substr(0, 4) + '-4' + hex.substr(0, 3) + '-a' + hex.substr(0, 3) + '-' + hex.substr(0, 12);
}

function viewConfig(id) {
    const c = appData.configs.find(x => x.id === id);
    if (!c) return;
    const user = appData.users.find(u => u.id === c.userId);
    const html = '<div class="form-group"><label>配置名称</label><div>' + escapeHtml(c.name) + '</div></div>' +
        '<div class="form-group"><label>用户</label><div>' + (user ? escapeHtml(user.name) : '已删除') + '</div></div>' +
        '<div class="form-group"><label>协议</label><div>' + escapeHtml(c.protocol) + '</div></div>' +
        '<div class="form-group"><label>配置内容</label><div class="config-block" id="configContentBlock">' + escapeHtml(c.content) + '</div></div>' +
        '<button class="btn btn-secondary" onclick="copyConfigContent(\'' + id + '\')"><i class="fas fa-copy"></i> 复制配置</button>' +
        '<button class="btn btn-secondary" onclick="downloadConfig(\'' + id + '\')" style="margin-left:8px"><i class="fas fa-download"></i> 下载配置</button>';
    addAuditLog('查看配置', '配置: ' + c.name);
    openModal('查看配置 - ' + escapeHtml(c.name), html);
}

function copyConfigContent(id) {
    const c = appData.configs.find(x => x.id === id);
    if (!c) return;
    navigator.clipboard.writeText(c.content).then(() => {
        showToast('配置已复制到剪贴板', 'success');
        addAuditLog('复制配置', '配置: ' + c.name);
    }).catch(() => {
        const el = document.getElementById('configContentBlock');
        if (el) {
            const range = document.createRange();
            range.selectNode(el);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            showToast('配置已复制', 'success');
            addAuditLog('复制配置', '配置: ' + c.name);
        }
    });
}

function downloadConfig(id) {
    const c = appData.configs.find(x => x.id === id);
    if (!c) return;
    const blob = new Blob([c.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name + '.conf';
    a.click();
    URL.revokeObjectURL(url);
    addAuditLog('下载配置', '配置: ' + c.name);
    showToast('配置已下载', 'success');
}

function deleteConfig(id) {
    if (!confirm('确定要删除此配置吗？')) return;
    const c = appData.configs.find(x => x.id === id);
    appData.configs = appData.configs.filter(x => x.id !== id);
    saveData();
    if (c) addActivity('系统', '删除配置 ' + c.name, 'success');
    renderConfigs();
    showToast('配置已删除', 'info');
}

function exportAllConfigs() {
    if (appData.configs.length === 0) { showToast('暂无配置可导出', 'error'); return; }
    const content = appData.configs.map(c => { return '# ====== ' + c.name + ' ======\n' + c.content; }).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vpn-configs-' + new Date().toISOString().split('T')[0] + '.txt';
    a.click();
    URL.revokeObjectURL(url);
    addAuditLog('批量导出', '导出 ' + appData.configs.length + ' 个配置');
    showToast('已导出 ' + appData.configs.length + ' 个配置', 'success');
}

function getConfigForUser(userId) {
    const user = appData.users.find(u => u.id === userId);
    if (!user) return;
    const configs = appData.configs.filter(c => c.userId === userId);
    if (configs.length === 0) {
        showToast('该用户暂无配置，请先生成', 'warning');
        return;
    }
    viewConfig(configs[0].id);
}

// ====== 流量统计 ======
function renderTraffic() {
    const period = document.getElementById('trafficPeriod').value;
    const userFilter = document.getElementById('trafficUser').value;
    const sel = document.getElementById('trafficUser');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="all">全部用户</option>' + appData.users.map(u => '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>').join('');
    sel.value = currentVal;

    let days = 7;
    if (period === '24h') days = 1;
    else if (period === '30d') days = 30;

    const ctx = document.getElementById('trafficDetailChart');
    if (trafficDetailChart) trafficDetailChart.destroy();

    const labels = [];
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        labels.push((d.getMonth() + 1) + '/' + d.getDate());
        let records = appData.trafficRecords.filter(r => r.date === dateStr);
        if (userFilter !== 'all') records = records.filter(r => r.userId === userFilter);
        const total = records.reduce((s, r) => s + (r.upload || 0) + (r.download || 0), 0);
        data.push(total / (1024*1024*1024));
    }

    trafficDetailChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: '流量 (GB)', data: data, backgroundColor: 'rgba(79,70,229,0.6)', borderColor: '#4f46e5', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v.toFixed(1) + ' GB' } } } }
    });

    const rankBody = document.getElementById('trafficRankBody');
    if (appData.users.length === 0) {
        rankBody.innerHTML = '<tr><td colspan="5" class="text-center">暂无数据</td></tr>';
        return;
    }
    const ranked = appData.users.map(u => {
        const records = appData.trafficRecords.filter(r => r.userId === u.id);
        const upload = records.reduce((s, r) => s + (r.upload || 0), 0);
        const download = records.reduce((s, r) => s + (r.download || 0), 0);
        return { name: u.name, upload: upload, download: download, total: upload + download };
    }).sort((a, b) => b.total - a.total);

    rankBody.innerHTML = ranked.map((r, i) => {
        const medal = i === 0 ? '#' + (i + 1) : i === 1 ? '#' + (i + 1) : i === 2 ? '#' + (i + 1) : '#' + (i + 1);
        return '<tr><td><strong>' + (i + 1) + '</strong></td><td>' + escapeHtml(r.name) + '</td><td>' + formatBytes(r.upload) + '</td><td>' + formatBytes(r.download) + '</td><td><strong>' + formatBytes(r.total) + '</strong></td></tr>';
    }).join('');
}

// ====== 系统设置 ======
function loadSettings() {
    document.getElementById('siteName').value = appData.settings.siteName || 'VPN管理面板';
    document.getElementById('defaultExpireDays').value = appData.settings.defaultExpireDays || 30;
    document.getElementById('defaultTrafficLimit').value = appData.settings.defaultTrafficLimit || 100;
    document.getElementById('notifyEmail').value = appData.settings.notifyEmail || '';
}

function saveSettings() {
    appData.settings.siteName = document.getElementById('siteName').value;
    appData.settings.defaultExpireDays = parseInt(document.getElementById('defaultExpireDays').value) || 30;
    appData.settings.defaultTrafficLimit = parseInt(document.getElementById('defaultTrafficLimit').value) || 100;
    appData.settings.notifyEmail = document.getElementById('notifyEmail').value;
    saveData();
    document.title = appData.settings.siteName + ' - VPN管理面板';
    document.querySelector('.logo span').textContent = appData.settings.siteName;
    showToast('设置已保存', 'success');
    addAuditLog('修改系统设置', '站点名称: ' + appData.settings.siteName);
}

// ====== 数据导入导出 ======
function exportData() {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vpn-data-backup-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
    addAuditLog('导出数据', '完整数据备份');
    showToast('数据已导出', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.users || !data.servers) {
                showToast('无效的数据文件', 'error');
                return;
            }
            if (!confirm('导入将覆盖当前所有数据，确定继续吗？')) return;
            appData = data;
            saveData();
            addAuditLog('导入数据', '从文件恢复数据');
            showToast('数据导入成功', 'success');
            renderDashboard();
        } catch (err) {
            showToast('文件解析失败: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function resetAllData() {
    if (!confirm('确定要重置所有数据吗？此操作不可撤销！')) return;
    if (!confirm('再次确认：所有用户、服务器、配置数据将被清除！')) return;
    appData = JSON.parse(JSON.stringify(defaultData));
    saveData();
    addAuditLog('重置数据', '所有数据已清除');
    renderDashboard();
    showToast('所有数据已重置', 'info');
}


// ====== 防火墙管理 ======
function getFirewallSettings() {
    return {
        enabled: localStorage.getItem('vpn_firewall_enabled') !== 'false',
        allowedIPs: JSON.parse(localStorage.getItem('vpn_firewall_allowed_ips') || '[]'),
        blockUnknown: localStorage.getItem('vpn_firewall_block_unknown') !== 'false',
        logAttacks: localStorage.getItem('vpn_firewall_log_attacks') !== 'false',
        maxAttempts: parseInt(localStorage.getItem('vpn_firewall_max_attempts')) || 5
    };
}

function saveFirewallSettings(settings) {
    localStorage.setItem('vpn_firewall_enabled', settings.enabled);
    localStorage.setItem('vpn_firewall_allowed_ips', JSON.stringify(settings.allowedIPs));
    localStorage.setItem('vpn_firewall_block_unknown', settings.blockUnknown);
    localStorage.setItem('vpn_firewall_log_attacks', settings.logAttacks);
    localStorage.setItem('vpn_firewall_max_attempts', settings.maxAttempts);
    showToast('防火墙设置已保存', 'success');
    addAuditLog('修改防火墙', '安全策略已更新');
}

function renderFirewallSettings() {
    const settings = getFirewallSettings();
    const enabledEl = document.getElementById('firewallEnabled');
    const blockEl = document.getElementById('firewallBlockUnknown');
    const logEl = document.getElementById('firewallLogAttacks');
    const maxEl = document.getElementById('firewallMaxAttempts');
    if (enabledEl) enabledEl.checked = settings.enabled;
    if (blockEl) blockEl.checked = settings.blockUnknown;
    if (logEl) logEl.checked = settings.logAttacks;
    if (maxEl) maxEl.value = settings.maxAttempts;
    renderAllowedIPs();
}

function renderAllowedIPs() {
    const settings = getFirewallSettings();
    const container = document.getElementById('allowedIPsList');
    if (!container) return;
    if (settings.allowedIPs.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">暂无IP白名单，添加您的IP以增强安全性</div>';
        return;
    }
    container.innerHTML = settings.allowedIPs.map(function(ip, i) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
            '<span style="flex:1;font-size:13px;font-family:monospace">' + escapeHtml(ip) + '</span>' +
            '<button class="btn-icon delete" onclick="removeAllowedIP(' + i + ')" title="移除"><i class="fas fa-times"></i></button></div>';
    }).join('');
}

function addAllowedIP() {
    const ip = document.getElementById('newAllowedIP').value.trim();
    if (!ip) { showToast('请输入IP地址', 'error'); return; }
    const settings = getFirewallSettings();
    if (settings.allowedIPs.indexOf(ip) !== -1) { showToast('该IP已在白名单中', 'warning'); return; }
    settings.allowedIPs.push(ip);
    saveFirewallSettings(settings);
    document.getElementById('newAllowedIP').value = '';
    renderAllowedIPs();
    addAuditLog('添加白名单IP', ip);
}

function removeAllowedIP(index) {
    const settings = getFirewallSettings();
    const removed = settings.allowedIPs.splice(index, 1)[0];
    saveFirewallSettings(settings);
    renderAllowedIPs();
    addAuditLog('移除白名单IP', removed);
}

function applyFirewallSettings() {
    const settings = {
        enabled: document.getElementById('firewallEnabled').checked,
        allowedIPs: getFirewallSettings().allowedIPs,
        blockUnknown: document.getElementById('firewallBlockUnknown').checked,
        logAttacks: document.getElementById('firewallLogAttacks').checked,
        maxAttempts: parseInt(document.getElementById('firewallMaxAttempts').value) || 5
    };
    saveFirewallSettings(settings);
    showToast('防火墙规则已更新，非白名单IP将被拦截', 'success');
}

// ====== 安全审计日志查看 ======
function showAuditLogs() {
    const logs = JSON.parse(localStorage.getItem('vpn_audit_logs') || '[]');
    if (logs.length === 0) {
        openModal('安全审计日志', '<div class="text-center" style="padding:20px;color:var(--text-muted)">暂无审计记录</div>');
        return;
    }
    const html = '<div style="max-height:400px;overflow-y:auto">' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
        '<th style="padding:6px 8px;text-align:left">时间</th>' +
        '<th style="padding:6px 8px;text-align:left">操作</th>' +
        '<th style="padding:6px 8px;text-align:left">详情</th></tr></thead><tbody>' +
        logs.slice(0, 50).map(function(l) {
            return '<tr style="border-bottom:1px solid var(--border)">' +
                '<td style="padding:6px 8px;font-size:11px">' + formatDate(l.time) + '</td>' +
                '<td style="padding:6px 8px">' + escapeHtml(l.operation) + '</td>' +
                '<td style="padding:6px 8px;font-size:11px;color:var(--text-secondary)">' + escapeHtml(l.detail) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<button class="btn btn-danger btn-sm" onclick="clearAuditLogs()" style="margin-top:12px"><i class="fas fa-trash"></i> 清除日志</button>';
    openModal('安全审计日志 (' + logs.length + '条)', html);
}

function clearAuditLogs() {
    if (!confirm('确定要清除所有审计日志吗？')) return;
    localStorage.setItem('vpn_audit_logs', '[]');
    closeModal();
    showToast('审计日志已清除', 'info');
}

// ====== 会话超时保护 ======
let sessionTimeout = null;

function resetSessionTimeout() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(function() {
        showToast('会话已超时，请刷新页面', 'warning');
        localStorage.setItem('vpn_session_expired', 'true');
    }, 30 * 60 * 1000);
}

document.addEventListener('click', resetSessionTimeout);
document.addEventListener('keydown', resetSessionTimeout);
document.addEventListener('mousemove', resetSessionTimeout);

// ====== 初始化 ======
function init() {
    renderDashboard();
    loadSettings();
    renderFirewallSettings();
    document.querySelector('.logo span').textContent = appData.settings.siteName || 'VPN管理';
    document.title = (appData.settings.siteName || 'VPN管理') + ' - 管理面板';
    resetSessionTimeout();

    if (localStorage.getItem('vpn_session_expired') === 'true') {
        showToast('检测到会话可能已泄露，建议导出数据后重置', 'warning');
        localStorage.removeItem('vpn_session_expired');
    }

    addAuditLog('系统启动', '管理面板已加载（安全增强版）');
}

document.addEventListener('DOMContentLoaded', init);
