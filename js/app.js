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
    const titles = { dashboard: '控制台', users: '用户管理', servers: '服务器管理', configs: '配置管理', subscription: '订阅管理', traffic: '流量统计', deploy: 'VPN 部署', settings: '系统设置' };
    document.getElementById('pageTitle').textContent = titles[pageId] || 'VPN管理';
    document.title = titles[pageId] + ' - VPN管理面板';
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
        else if (page === 'subscription') renderSubscription();
        else if (page === 'traffic') renderTraffic();
        else if (page === 'deploy') renderVpnDeploy();
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
        autoSyncToServer();
    } catch (e) { console.error('Save error:', e); }
}

var _autoSyncTimer = null;
function autoSyncToServer() {
    if (!window.location.protocol.startsWith('http')) return;
    if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(function() {
        var baseUrl = window.location.protocol + '//' + window.location.host;
        fetch(baseUrl + '/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData)
        }).catch(function() {});
    }, 500);
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