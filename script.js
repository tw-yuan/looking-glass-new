// 節點數據
let nodesData = { nodes: [] };

// 使用日誌
let usageLogs = JSON.parse(localStorage.getItem('lookingGlassLogs') || '[]');
let userIP = 'unknown';
let sessionId = localStorage.getItem('sessionId') || generateSessionId();

// 生成會話ID
function generateSessionId() {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    localStorage.setItem('sessionId', id);
    return id;
}

// 獲取用戶IP
async function getUserIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        userIP = data.ip;
    } catch (error) {
        console.log('無法獲取IP地址');
        userIP = 'unknown';
    }
}

// 記錄使用日誌到伺服器
async function logUsage(action, details = {}) {
    // 只記錄實際測試動作，不記錄點擊
    if (action !== 'test_started') {
        return;
    }
    
    // 確保有 IP 地址
    if (userIP === 'unknown') {
        await getUserIP();
    }
    
    const logEntry = {
        action: action,
        nodeName: details.nodeName || 'unknown',
        nodeLocation: details.nodeLocation || 'unknown',
        testType: details.testType || null,
        target: details.target || null,
        sessionId: sessionId
    };
    
    // 同時保存到本地
    const localEntry = {
        ...logEntry,
        timestamp: new Date().toISOString(),
        ip: userIP
    };
    
    usageLogs.push(localEntry);
    if (usageLogs.length > 500) {
        usageLogs = usageLogs.slice(-500);
    }
    localStorage.setItem('lookingGlassLogs', JSON.stringify(usageLogs));
    
    // 使用 JSONBin.io 記錄
    if (CONFIG && CONFIG.USE_JSONBIN && CONFIG.JSONBIN_ID && CONFIG.JSONBIN_API_KEY) {
        try {
            // 先獲取現有日誌
            const getResponse = await fetch(`${CONFIG.JSONBIN_BASE_URL}/b/${CONFIG.JSONBIN_ID}/latest`, {
                headers: {
                    'X-Master-Key': CONFIG.JSONBIN_API_KEY
                }
            });
            
            let logsData = { logs: [], totalRecords: 0, lastUpdate: new Date().toISOString() };
            
            if (getResponse.ok) {
                const result = await getResponse.json();
                if (result.record && result.record.logs) {
                    logsData = result.record;
                }
            }
            
            // 添加新日誌
            const serverEntry = {
                ...localEntry,
                id: Date.now().toString(36) + Math.random().toString(36).substr(2)
            };
            
            logsData.logs.unshift(serverEntry);
            logsData.totalRecords = logsData.logs.length;
            logsData.lastUpdate = new Date().toISOString();
            
            // 只保留最近的記錄
            if (logsData.logs.length > 1000) {
                logsData.logs = logsData.logs.slice(0, 1000);
            }
            
            // 更新 JSONBin
            const updateResponse = await fetch(`${CONFIG.JSONBIN_BASE_URL}/b/${CONFIG.JSONBIN_ID}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': CONFIG.JSONBIN_API_KEY
                },
                body: JSON.stringify(logsData)
            });
            
            if (updateResponse.ok) {
                console.log('日誌已記錄到 JSONBin.io');
            }
            
        } catch (error) {
            console.error('JSONBin.io 錯誤:', error);
        }
    }
    // 或使用 Cloudflare Worker
    else if (CONFIG && CONFIG.ENABLE_LOGGING && CONFIG.WORKER_URL) {
        try {
            const workerUrl = `${CONFIG.WORKER_URL}/api/logs`;
            
            const response = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logEntry)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('日誌已記錄到伺服器:', result);
            
        } catch (error) {
            console.error('無法發送日誌到伺服器:', error);
        }
    }
}

// 分析 Target 使用情況
function analyzeTargetUsage(logs) {
    const targetStats = {};
    
    logs.forEach(log => {
        if (log.action === 'test_started' && log.target && log.target !== 'null') {
            const target = log.target.toLowerCase();
            if (!targetStats[target]) {
                targetStats[target] = {
                    name: log.target,
                    count: 0,
                    uniqueUsers: new Set(),
                    testTypes: {},
                    type: detectTargetType(log.target)
                };
            }
            
            targetStats[target].count++;
            if (log.ip && log.ip !== 'unknown') {
                targetStats[target].uniqueUsers.add(log.ip);
            }
            if (log.testType) {
                targetStats[target].testTypes[log.testType] = (targetStats[target].testTypes[log.testType] || 0) + 1;
            }
        }
    });
    
    return Object.values(targetStats)
        .map(target => ({
            ...target,
            uniqueUsers: target.uniqueUsers.size,
            mainTestType: Object.keys(target.testTypes).reduce((a, b) => 
                target.testTypes[a] > target.testTypes[b] ? a : b, 'ping')
        }))
        .sort((a, b) => b.count - a.count);
}

// 分析測試類型使用情況
function analyzeTestTypes(logs) {
    const typeStats = {};
    
    logs.forEach(log => {
        if (log.action === 'test_started' && log.testType) {
            if (!typeStats[log.testType]) {
                typeStats[log.testType] = {
                    count: 0,
                    uniqueUsers: new Set(),
                    targets: new Set()
                };
            }
            
            typeStats[log.testType].count++;
            if (log.ip && log.ip !== 'unknown') {
                typeStats[log.testType].uniqueUsers.add(log.ip);
            }
            if (log.target && log.target !== 'null') {
                typeStats[log.testType].targets.add(log.target);
            }
        }
    });
    
    return typeStats;
}

// 偵測目標類型
function detectTargetType(target) {
    if (!target || target === 'null') return '未知';
    
    // IPv4 位址檢測
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (ipv4Regex.test(target)) {
        return 'IPv4';
    }
    
    // IPv6 位址檢測
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    if (ipv6Regex.test(target) || target.includes('::')) {
        return 'IPv6';
    }
    
    // 域名檢測
    if (target.includes('.')) {
        // 常見公共 DNS
        const publicDNS = ['8.8.8.8', '1.1.1.1', '208.67.222.222', '9.9.9.9', '2001:4860:4860::8888', '2606:4700:4700::1111'];
        if (publicDNS.includes(target)) return '公共 DNS';
        
        // 常見網站
        const commonSites = ['google.com', 'facebook.com', 'youtube.com', 'github.com', 'stackoverflow.com'];
        if (commonSites.some(site => target.includes(site))) return '常見網站';
        
        return '域名';
    }
    
    return '其他';
}

// 處理 IP 顯示（支援 IPv4 和 IPv6）
function formatIPDisplay(ip) {
    if (!ip || ip === 'unknown') return '未知';
    
    // IPv4 處理
    if (ip.includes('.') && !ip.includes(':')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }
    }
    
    // IPv6 處理
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length >= 3) {
            return `${parts[0]}:${parts[1]}:${parts[2]}:xxxx`;
        }
    }
    
    // 其他情況
    return ip.length > 8 ? ip.substring(0, 8) + '...' : ip;
}

// 顯示使用日誌
async function showUsageLogs() {
    // 先顯示模態框
    showLogsModal();
    
    // 從伺服器獲取整體日誌
    let logs = [];
    try {
        // 使用 JSONBin.io
        if (CONFIG && CONFIG.USE_JSONBIN && CONFIG.JSONBIN_ID && CONFIG.JSONBIN_API_KEY) {
            const response = await fetch(`${CONFIG.JSONBIN_BASE_URL}/b/${CONFIG.JSONBIN_ID}/latest`, {
                headers: {
                    'X-Master-Key': CONFIG.JSONBIN_API_KEY
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.record && result.record.logs) {
                    logs = result.record.logs || [];
                }
            } else {
                throw new Error('JSONBin.io 回應錯誤');
            }
        }
        // 或使用 Cloudflare Worker
        else if (CONFIG && CONFIG.WORKER_URL) {
            const workerUrl = `${CONFIG.WORKER_URL}/api/logs?limit=200`;
            const response = await fetch(workerUrl);
            if (response.ok) {
                const data = await response.json();
                logs = data.logs || [];
            } else {
                throw new Error('Worker 回應錯誤');
            }
        } else {
            throw new Error('未設定任何日誌服務');
        }
    } catch (error) {
        console.log('無法從伺服器獲取日誌，使用本地日誌:', error);
        logs = JSON.parse(localStorage.getItem('lookingGlassLogs') || '[]');
    }
    
    const recentLogs = logs.slice(0, 50); // 最近50條
    
    // 統計分析 - 只關注實際測試
    const stats = {
        totalTests: 0,
        testsByType: {},
        testsByNode: {},
        uniqueIPs: new Set(),
        testsByIP: {},
        nodeUsage: {}
    };
    
    // 統計所有節點的使用情況 - 只記錄實際測試
    nodesData.nodes.forEach(node => {
        stats.nodeUsage[node.name] = {
            name: node.name,
            location: node.location_zh || node.location,
            provider: node.provider,
            tests: 0,
            uniqueUsers: new Set()
        };
    });
    
    logs.forEach(log => {
        if (log.ip && log.ip !== 'unknown') {
            stats.uniqueIPs.add(log.ip);
        }
        
        if (log.action === 'test_started') {
            stats.totalTests++;
            if (log.testType) {
                stats.testsByType[log.testType] = (stats.testsByType[log.testType] || 0) + 1;
            }
            if (log.nodeName) {
                stats.testsByNode[log.nodeName] = (stats.testsByNode[log.nodeName] || 0) + 1;
                if (stats.nodeUsage[log.nodeName]) {
                    stats.nodeUsage[log.nodeName].tests++;
                    if (log.ip && log.ip !== 'unknown') {
                        stats.nodeUsage[log.nodeName].uniqueUsers.add(log.ip);
                    }
                }
            }
            if (log.ip && log.ip !== 'unknown') {
                stats.testsByIP[log.ip] = (stats.testsByIP[log.ip] || 0) + 1;
            }
        }
        
        // 不再記錄點擊行為，只關注實際測試
    });
    
    // 準備節點使用情況排序 - 只按測試數排序
    const nodeUsageArray = Object.values(stats.nodeUsage)
        .map(node => ({
            ...node,
            uniqueUsers: node.uniqueUsers.size
        }))
        .filter(node => node.tests > 0) // 只顯示有實際測試的節點
        .sort((a, b) => b.tests - a.tests);
    
    // 更新現有模態框內容
    updateLogsModalContent(stats, nodeUsageArray, recentLogs);
}

// 顯示日誌模態框
function showLogsModal() {
    let modal = document.getElementById('logsModal');
    
    if (!modal) {
        // 創建日誌模態框
        modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'logsModal';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('data-bs-backdrop', 'true');
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">使用情況分析</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="logsModalBody">
                        <div class="text-center p-4">
                            <div class="spinner-border" role="status">
                                <span class="visually-hidden">載入中...</span>
                            </div>
                            <p class="mt-2 text-muted">正在載入日誌資料...</p>
                        </div>
                    </div>
                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">關閉</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 清理 modal
        modal.addEventListener('hidden.bs.modal', () => {
            // 檢查統計面板是否還開啟
            const statsModal = document.getElementById('statsModal');
            const isStatsModalOpen = statsModal && statsModal.classList.contains('show');
            
            // 重置統計面板的層級
            if (isStatsModalOpen) {
                statsModal.style.zIndex = '';
            }
            
            // 只移除日誌相關的背景，保留統計面板的背景
            const logsBackdrop = document.querySelector('.modal-backdrop[data-logs-backdrop="true"]');
            if (isStatsModalOpen && logsBackdrop) {
                // 如果統計面板還開啟，只移除日誌的背景
                if (logsBackdrop.parentNode) {
                    logsBackdrop.parentNode.removeChild(logsBackdrop);
                }
            } else if (!isStatsModalOpen) {
                // 如果統計面板已關閉，清除所有背景和重置 body
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                
                const allBackdrops = document.querySelectorAll('.modal-backdrop');
                allBackdrops.forEach(backdrop => {
                    if (backdrop.parentNode) {
                        backdrop.parentNode.removeChild(backdrop);
                    }
                });
            } else {
                // 如果統計面板還開啟，確保 body 狀態正確
                document.body.classList.add('modal-open');
            }
            
            // 延遲移除，避免動畫問題
            setTimeout(() => {
                if (modal.parentNode) {
                    document.body.removeChild(modal);
                }
            }, 300);
        });
    }
    
    // 確保統計面板的模態框層級正確
    const statsModal = document.getElementById('statsModal');
    if (statsModal && statsModal.classList.contains('show')) {
        statsModal.style.zIndex = '1050';
    }
    
    const modalInstance = new bootstrap.Modal(modal, {
        backdrop: true,
        keyboard: true,
        focus: true
    });
    
    // 添加事件監聽器
    modal.addEventListener('shown.bs.modal', () => {
        // 確保背景模糊效果和層級
        const backdrops = document.querySelectorAll('.modal-backdrop.show');
        if (backdrops.length > 0) {
            const lastBackdrop = backdrops[backdrops.length - 1];
            lastBackdrop.style.zIndex = '1055';
            // 為日誌背景添加標識
            lastBackdrop.setAttribute('data-logs-backdrop', 'true');
        }
    });
    
    modalInstance.show();
}

// 更新日誌模態框內容 - Target 分析導向
function updateLogsModalContent(stats, nodeUsageArray, recentLogs) {
    const modalBody = document.getElementById('logsModalBody');
    if (!modalBody) return;
    
    // 使用 DocumentFragment 提升性能
    const fragment = document.createDocumentFragment();
    const container = document.createElement('div');
    
    // 限制顯示數量以提升性能
    const maxTargetDisplay = 15;
    const maxLogDisplay = 25;
    
    // 分析 Target 使用情況
    const targetAnalysis = analyzeTargetUsage(recentLogs);
    const testTypeStats = analyzeTestTypes(recentLogs);
    
    container.innerHTML = `
        <!-- 統計概覽 -->
        <div class="row mb-2 g-1">
            <div class="col-3">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-primary mb-0">${stats.totalTests}</h5>
                    <small class="text-muted">總測試</small>
                </div>
            </div>
            <div class="col-3">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-info mb-0">${stats.uniqueIPs.size}</h5>
                    <small class="text-muted">用戶數</small>
                </div>
            </div>
            <div class="col-3">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-success mb-0">${targetAnalysis.length}</h5>
                    <small class="text-muted">目標數</small>
                </div>
            </div>
            <div class="col-3">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-warning mb-0">${Object.keys(testTypeStats).length}</h5>
                    <small class="text-muted">測試類型</small>
                </div>
            </div>
        </div>
        
        <!-- 熱門目標分析 -->
        <div class="card mb-2" style="margin-top: 1rem;">
            <div class="card-header py-1">
                <small class="mb-0 fw-bold">熱門目標分析</small>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th class="py-1 text-center small">目標</th>
                                <th class="py-1 text-center small">測試次數</th>
                                <th class="py-1 text-center small">使用者</th>
                                <th class="py-1 text-center small">主要類型</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${targetAnalysis.slice(0, maxTargetDisplay).map(target => `
                                <tr>
                                    <td class="py-1 text-center">
                                        <div class="fw-bold small text-primary">${target.name}</div>
                                        <small class="text-muted">${target.type}</small>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-primary" style="font-size: 0.7rem;">${target.count}</span>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-info" style="font-size: 0.7rem;">${target.uniqueUsers}</span>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-success" style="font-size: 0.7rem;">${target.mainTestType}</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <!-- 節點使用效率 -->
        <div class="card mb-2" style="margin-top: 1rem;">
            <div class="card-header py-1">
                <small class="mb-0 fw-bold">節點使用效率</small>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th class="py-1 text-center small">節點</th>
                                <th class="py-1 text-center small">提供者</th>
                                <th class="py-1 text-center small">測試數</th>
                                <th class="py-1 text-center small">使用者</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${nodeUsageArray.filter(node => node.tests > 0).slice(0, 15).map(node => `
                                <tr>
                                    <td class="py-1 text-center">
                                        <div class="fw-bold small">${node.name}</div>
                                        <small class="text-muted" style="font-size: 0.7rem;">${node.location}</small>
                                    </td>
                                    <td class="py-1 text-center small">
                                        <a href="${node.providerLink || node['provider-link'] || '#'}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">
                                            ${node.provider}
                                        </a>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-primary" style="font-size: 0.7rem;">${node.tests}</span>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-success" style="font-size: 0.7rem;">${node.uniqueUsers}</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <!-- 最近活動 -->
        <div class="card" style="margin-top: 1rem;">
            <div class="card-header py-1 d-flex justify-content-between align-items-center">
                <small class="mb-0 fw-bold">最近活動 (整體)</small>
                <div>
                    <button class="btn btn-xs btn-outline-success me-1" onclick="exportServerLogs(event)" title="匯出整體日誌" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">整體匯出</button>
                    <button class="btn btn-xs btn-outline-info me-1" onclick="exportLogs(event)" title="匯出本地日誌" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">本地匯出</button>
                    <button class="btn btn-xs btn-outline-danger" onclick="clearLogs()" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">清除本地</button>
                </div>
            </div>
            <div class="card-body p-0">
                <div style="max-height: 180px; overflow-y: auto;">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">時間</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">動作</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">節點</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">詳細</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentLogs.slice(0, maxLogDisplay).map(log => `
                                <tr>
                                    <td class="py-0 text-center text-muted" style="font-size: 0.65rem;">
                                        ${new Date(log.timestamp).toLocaleString('zh-TW', {
                                            month: 'numeric', 
                                            day: 'numeric', 
                                            hour: '2-digit', 
                                            minute: '2-digit'
                                        })}
                                    </td>
                                    <td class="py-0 text-center">
                                        <span class="badge bg-${getActionColor(log.action)}" style="font-size: 0.6rem;">${getActionName(log.action)}</span>
                                    </td>
                                    <td class="py-0 text-center fw-bold" style="font-size: 0.65rem;">${log.nodeName}</td>
                                    <td class="py-0 text-center" style="font-size: 0.65rem;">
                                        ${log.testType ? 
                                            `<span class="text-primary">${log.testType.toUpperCase()}</span><br><span class="text-muted">${log.target || ''}</span>` : 
                                            `<span class="text-muted">${log.nodeLocation}</span>`
                                        }
                                    </td>
                                    <td class="py-0 text-center text-muted" style="font-size: 0.65rem;">
                                        ${formatIPDisplay(log.ip)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${recentLogs.filter(log => log.action === 'test_started').length === 0 ? 
                        '<div class="text-center text-muted p-3"><small>尚無測試記錄</small></div>' : ''}
                </div>
            </div>
        </div>
    `;
    
    // 添加到 fragment 並更新 DOM
    fragment.appendChild(container);
    modalBody.innerHTML = '';
    modalBody.appendChild(fragment);
}


// 獲取動作對應的顏色
function getActionColor(action) {
    const colors = {
        'test_started': 'primary'
    };
    return colors[action] || 'secondary';
}

// 獲取動作的中文名稱
function getActionName(action) {
    const names = {
        'test_started': '測試'
    };
    return names[action] || action;
}

// 匯出日誌
function exportLogs(event) {
    const logs = JSON.parse(localStorage.getItem('lookingGlassLogs') || '[]');
    
    if (logs.length === 0) {
        alert('沒有日誌資料可以匯出');
        return;
    }
    
    // 準備CSV內容 - 修復格式問題
    const csvHeaders = ['時間', '動作', '節點名稱', '節點位置', '測試類型', '測試目標', 'IP地址'];
    const csvRows = logs.map(log => {
        // 清理和格式化每個欄位，避免換行符號問題
        return [
            new Date(log.timestamp).toLocaleString('zh-TW').replace(/[\\r\\n]/g, ' '),
            log.action === 'test_started' ? '測試' : log.action,
            (log.nodeName || '').replace(/[\\r\\n,]/g, ' '),
            (log.nodeLocation || '').replace(/[\\r\\n,]/g, ' '),
            (log.testType || '').replace(/[\\r\\n,]/g, ' '),
            (log.target || '').replace(/[\\r\\n,]/g, ' '),
            (log.ip || '').replace(/[\\r\\n,]/g, ' ')
        ];
    });
    
    // 建立正確的CSV內容
    const csvContent = csvHeaders.join(',') + '\\r\\n' + 
        csvRows.map(row => 
            row.map(field => {
                // 處理包含逗號或引號的欄位
                const cleanField = String(field).replace(/"/g, '""');
                return cleanField.includes(',') || cleanField.includes('"') ? 
                    `"${cleanField}"` : cleanField;
            }).join(',')
        ).join('\\r\\n');
    
    // 建立下載連結，使用UTF-8 BOM確保中文正確顯示
    const BOM = '\\uFEFF';
    const blob = new Blob([BOM + csvContent], { 
        type: 'text/csv;charset=utf-8;' 
    });
    
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `looking-glass-logs-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // 顯示成功訊息
    const btn = event?.target;
    if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check"></i> 已匯出';
        btn.classList.remove('btn-outline-success');
        btn.classList.add('btn-success');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-outline-success');
        }, 2000);
    }
}

// 清除日誌
function clearLogs() {
    if (confirm('確定要清除所有日誌嗎？此操作無法復原。')) {
        localStorage.removeItem('lookingGlassLogs');
        usageLogs.length = 0;
        alert('日誌已清除');
        // 關閉模態框並重新開啟
        const modal = document.getElementById('logsModal');
        if (modal) {
            bootstrap.Modal.getInstance(modal).hide();
        }
    }
}

// 匯出伺服器全域日誌
async function exportServerLogs(event) {
    try {
        let logs = [];
        
        // 使用 JSONBin.io
        if (CONFIG && CONFIG.USE_JSONBIN && CONFIG.JSONBIN_ID && CONFIG.JSONBIN_API_KEY) {
            const response = await fetch(`${CONFIG.JSONBIN_BASE_URL}/b/${CONFIG.JSONBIN_ID}/latest`, {
                headers: {
                    'X-Master-Key': CONFIG.JSONBIN_API_KEY
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.record && result.record.logs) {
                    logs = result.record.logs || [];
                }
            } else {
                throw new Error('無法從 JSONBin.io 獲取日誌');
            }
        }
        // 或使用 Cloudflare Worker
        else if (CONFIG && CONFIG.WORKER_URL) {
            const workerUrl = `${CONFIG.WORKER_URL}/api/logs?limit=1000`;
            const response = await fetch(workerUrl);
            if (!response.ok) {
                throw new Error('無法從 Worker 獲取日誌');
            }
            const data = await response.json();
            logs = data.logs || [];
        } else {
            throw new Error('未設定任何日誌服務');
        }
        
        if (logs.length === 0) {
            alert('沒有伺服器日誌資料可以匯出');
            return;
        }
        
        // 準備CSV內容
        const csvHeaders = ['時間', '動作', '節點名稱', '節點位置', '測試類型', '測試目標', 'IP地址', '會話ID'];
        const csvRows = logs.map(log => {
            return [
                new Date(log.timestamp).toLocaleString('zh-TW').replace(/[\r\n]/g, ' '),
                log.action === 'test_started' ? '測試' : log.action,
                (log.nodeName || '').replace(/[\r\n,]/g, ' '),
                (log.nodeLocation || '').replace(/[\r\n,]/g, ' '),
                (log.testType || '').replace(/[\r\n,]/g, ' '),
                (log.target || '').replace(/[\r\n,]/g, ' '),
                (log.ip || '').replace(/[\r\n,]/g, ' '),
                (log.sessionId || '').replace(/[\r\n,]/g, ' ')
            ];
        });
        
        // 建立CSV內容
        const csvContent = csvHeaders.join(',') + '\r\n' + 
            csvRows.map(row => 
                row.map(field => {
                    const cleanField = String(field).replace(/"/g, '""');
                    return cleanField.includes(',') || cleanField.includes('"') ? 
                        `"${cleanField}"` : cleanField;
                }).join(',')
            ).join('\r\n');
        
        // 下載檔案
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `global-logs-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // 顯示成功訊息
        const btn = event?.target;
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="bi bi-check"></i> 已匯出';
            btn.classList.remove('btn-outline-success');
            btn.classList.add('btn-success');
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('btn-success');
                btn.classList.add('btn-outline-success');
            }, 2000);
        }
        
    } catch (error) {
        console.error('匯出伺服器日誌失敗:', error);
        alert('匯出失敗：' + error.message);
    }
}

// 初始化頁面
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 初始化主題
        initTheme();
        
        const response = await fetch('nodes.json');
        nodesData = await response.json();
        renderNodes();
        setupModal();
        updateCopyrightYear();
        
        // 初始化統計面板
        initStatsPanel();
        
        // 檢查主畫面節點狀態
        checkMainNodeStatus();
        
        // 獲取用戶IP
        await getUserIP();
        
        // 測試日誌功能（可選，用於除錯）
        console.log('用戶IP:', userIP, '會話ID:', sessionId);
    } catch (error) {
        console.error('無法載入節點數據:', error);
    }
});

// 更新版權年份
function updateCopyrightYear() {
    const yearElement = document.querySelector('.copyright-year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

// 渲染節點卡片
function renderNodes() {
    const container = document.getElementById('nodesContainer');
    nodesData.nodes.forEach(node => {
        const nodeElement = createNodeCard(node);
        container.appendChild(nodeElement);
    });
}

// 創建節點卡片
function createNodeCard(node) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 col-xl-3';
    
    col.innerHTML = `
        <div class="bg-white border border-2 rounded-3 p-4 text-center shadow-sm h-100 node-card position-relative">
            <div class="node-card-status" id="main_status_${nodesData.nodes.indexOf(node)}">
                <div class="spinner-border spinner-border-sm text-muted" role="status">
                    <span class="visually-hidden">檢查中...</span>
                </div>
            </div>
            <div class="fw-semibold fs-5 text-dark mb-1">${node.name}</div>
            ${node.name_zh ? `<div class="text-muted small mb-2">${node.name_zh}</div>` : '<div class="mb-2"></div>'}
            <div class="text-muted mb-2">${node.location_zh ? `${node.location_zh} • ${node.location}` : node.location}</div>
            <div class="text-muted small mb-3">
            <span>Provider: </span>
                <a href="${node['provider-link']}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">
                    ${node.provider}
                </a>
            </div>
        </div>
    `;

    col.querySelector('.node-card').addEventListener('click', () => {
        showNodeModal(node);
    });

    return col;
}

// 設置模態框
function setupModal() {
    const modal = document.getElementById('nodeModal');
    const modalInstance = new bootstrap.Modal(modal);
    
    // ESC 鍵關閉模態框
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('show')) {
            modalInstance.hide();
        }
    });

    // 監聽模態框關閉事件
    modal.addEventListener('hidden.bs.modal', () => {
        // 清除測試結果
        const resultContainer = modal.querySelector('.mt-4');
        if (resultContainer) {
            resultContainer.remove();
        }
        // 清除目標主機欄位
        const targetInput = modal.querySelector('input[type="text"]');
        if (targetInput) {
            targetInput.value = '';
        }
    });
}

// 顯示節點模態框
function showNodeModal(node) {
    const modal = document.getElementById('nodeModal');
    const modalTitle = modal.querySelector('.modal-title');
    const nodeLocation = modal.querySelector('.node-location');
    const providerLink = modal.querySelector('.provider-link');
    const testButton = modal.querySelector('.btn-primary');
    const targetInput = modal.querySelector('input[type="text"]');
    const testTypeSelect = modal.querySelector('select');

    modalTitle.innerHTML = node.name_zh ? `${node.name}<small class="text-muted ms-2">${node.name_zh}</small>` : node.name;
    nodeLocation.textContent = node.location_zh ? `${node.location_zh} • ${node.location}` : node.location;
    providerLink.textContent = node.provider;
    providerLink.href = node['provider-link'];

    // 移除舊的事件監聽器
    const newTestButton = testButton.cloneNode(true);
    testButton.parentNode.replaceChild(newTestButton, testButton);

    // 添加新的事件監聽器
    newTestButton.addEventListener('click', async () => {
        const target = targetInput.value.trim();
        const testType = testTypeSelect.value;
        
        if (!target) {
            alert('請輸入目標主機');
            return;
        }

        // 記錄測試開始
        logUsage('test_started', {
            testType: testType,
            target: target,
            nodeName: node.name,
            nodeLocation: node.location
        });

        try {
            newTestButton.disabled = true;
            newTestButton.textContent = '測試中...';

            // 發送測量請求
            const measurementResponse = await fetch('https://api.globalping.io/v1/measurements', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    type: testType,
                    target: target,
                    inProgressUpdates: true,
                    locations: [{
                        magic: node.tags
                    }]
                })
            });

            const measurementData = await measurementResponse.json();
            
            if (!measurementData.id) {
                throw new Error('無法獲取測量 ID');
            }


            // 顯示等待訊息
            const resultContainer = document.createElement('div');
            resultContainer.className = 'mt-4';
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果</h5>
                <div class="alert alert-info">
                    <p class="mb-0">正在等待測試結果... (ID: ${measurementData.id})</p>
                </div>
            `;

            // 移除舊的結果（如果有的話）
            const oldResult = modal.querySelector('.mt-4');
            if (oldResult) {
                oldResult.remove();
            }

            modal.querySelector('.modal-body').appendChild(resultContainer);

            // 輪詢測量結果
            let result = null;
            let attempts = 0;
            const maxAttempts = 30; // 最多等待 30 秒

            while (attempts < maxAttempts) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                try {
                    const resultResponse = await fetch(`https://api.globalping.io/v1/measurements/${measurementData.id}`, {
                        method: 'GET',
                        headers: {
                            'accept': 'application/json'
                        }
                    });
                    const resultData = await resultResponse.json();
                    
                    if (resultData.results && resultData.results.length > 0) {
                        result = resultData.results[0];
                        // 檢查狀態是否為 finished
                        if (result.result.status === 'finished') {
                            break;
                        } else if (result.result.status === 'in-progress') {
                            // 更新等待訊息
                            resultContainer.innerHTML = `
                                <h5 class="mb-3">測試結果</h5>
                                <div class="alert alert-info">
                                    <p class="mb-0">測試進行中... (ID: ${measurementData.id})</p>
                                    <p class="mb-0">已等待 ${attempts} 秒</p>
                                </div>
                            `;
                            continue;
                        }
                    }
                } catch (error) {
                    console.error('輪詢失敗:', error);
                }
            }

            if (!result || result.result.status !== 'finished') {
                throw new Error('測試超時或未完成，請稍後再試');
            }

            // 更新結果顯示
            const probeInfo = result.probe;
            const resultInfo = result.result;
            console.log(resultInfo);
            console.log(resultInfo.rawOutput);
            
            // 判斷目標是 IPv4 還是 IPv6
            const isIPv6 = target.includes(':');
            
            // 嘗試從測試結果中提取實際使用的 IP 資訊
            let actualNetwork = probeInfo.network;
            let actualASN = probeInfo.asn;
            let protocolInfo = isIPv6 ? 'IPv6' : 'IPv4';
            
            // 從原始輸出中嘗試解析更準確的資訊
            const rawOutput = resultInfo.rawOutput || '';
            
            // 對於 traceroute 和 mtr，嘗試從輸出中提取實際的源 IP
            let sourceIP = '';
            if (testType === 'traceroute' || testType === 'mtr') {
                // 嘗試匹配 "from" 後面的 IP 地址
                const fromMatch = rawOutput.match(/from\s+([\d.]+|[a-fA-F0-9:]+)/);
                if (fromMatch) {
                    sourceIP = fromMatch[1];
                    protocolInfo = sourceIP.includes(':') ? 'IPv6' : 'IPv4';
                }
            }
            
            // 對於 ping，檢查輸出中的協議資訊
            if (testType === 'ping') {
                if (rawOutput.includes('ping6') || rawOutput.includes('PING6')) {
                    protocolInfo = 'IPv6';
                } else if (rawOutput.includes('ping') || rawOutput.includes('PING')) {
                    protocolInfo = 'IPv4';
                }
            }
            
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果</h5>
                <div class="bg-light p-3 rounded mb-3">
                    <h6 class="mb-2">探測點資訊</h6>
                    <div class="row">
                        <div class="col-md-6">
                            <p class="mb-1"><strong>網路：</strong> ${actualNetwork}</p>
                            <p class="mb-1"><strong>ASN：</strong> ${actualASN}</p>
                            <p class="mb-1"><strong>使用協議：</strong> ${protocolInfo}</p>
                            ${sourceIP ? `<p class="mb-1"><strong>源 IP：</strong> ${sourceIP}</p>` : ''}
                        </div>
                        <div class="col-md-6">
                            <p class="mb-1"><strong>DNS：</strong> ${probeInfo.resolvers.join(', ')}</p>
                            <p class="mb-1"><strong>目標：</strong> ${target}</p>
                        </div>
                    </div>
                    <div class="text-muted small mt-2">
                        <i class="bi bi-info-circle"></i>
                        IPv4/IPv6 混合環境下 ASN 資訊可能不準確
                    </div>
                </div>
                <div class="bg-light p-3 rounded">
                    <h6 class="mb-2">測試輸出(ID: ${measurementData.id})</h6>
                    <pre class="mb-0 test-output">${resultInfo.rawOutput}</pre>
                </div>
            `;


        } catch (error) {
            console.error('測試失敗:', error);
            
            
            alert('測試失敗: ' + error.message);
        } finally {
            newTestButton.disabled = false;
            newTestButton.textContent = '開始測試';
        }
    });

    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    modalInstance.show();
}

// 初始化主題
function initTheme() {
    // 檢查本地存儲的主題設定或系統偏好
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    
    // 檢查本地存儲的顏色設定
    const savedColor = localStorage.getItem('themeColor') || 'blue';
    
    // 設定主題和顏色
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-color', savedColor);
    updateThemeToggleButton(theme);
    
    // 設定主題切換按鈕事件
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.addEventListener('click', toggleTheme);
    
    // 初始化顏色選擇器
    initColorPicker(savedColor);
}

// 切換主題
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeToggleButton(newTheme);
}

// 更新主題切換按鈕圖示
function updateThemeToggleButton(theme) {
    const themeToggle = document.getElementById('themeToggle');
    const icon = themeToggle.querySelector('i');
    
    if (theme === 'dark') {
        icon.className = 'bi bi-sun-fill';
        themeToggle.setAttribute('aria-label', '切換淺色模式');
    } else {
        icon.className = 'bi bi-moon-fill';
        themeToggle.setAttribute('aria-label', '切換深色模式');
    }
}

// 初始化顏色選擇器
function initColorPicker(currentColor) {
    const colorToggleBtn = document.getElementById('colorToggleBtn');
    const colorOptions = document.getElementById('colorOptions');
    const colorOptionItems = document.querySelectorAll('.color-option');
    
    // 添加切換按鈕事件
    colorToggleBtn.addEventListener('click', function() {
        const isVisible = colorOptions.style.display !== 'none';
        colorOptions.style.display = isVisible ? 'none' : 'flex';
    });
    
    // 點擊外部關閉調色盤
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.color-picker')) {
            colorOptions.style.display = 'none';
        }
    });
    
    // 標記當前顏色
    colorOptionItems.forEach(option => {
        if (option.dataset.color === currentColor) {
            option.classList.add('active');
        }
        
        // 添加點擊事件
        option.addEventListener('click', function() {
            const newColor = this.dataset.color;
            changeThemeColor(newColor);
            colorOptions.style.display = 'none'; // 選擇後關閉
        });
    });
}

// 改變主題顏色
function changeThemeColor(color) {
    // 更新 HTML 屬性
    document.documentElement.setAttribute('data-color', color);
    
    // 保存到 localStorage
    localStorage.setItem('themeColor', color);
    
    // 更新選中狀態
    document.querySelectorAll('.color-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelector(`.color-option[data-color="${color}"]`).classList.add('active');
    
    // 更新 favicon 顏色
    updateFaviconColor(color);
}

// 更新 favicon 顏色
function updateFaviconColor(color) {
    const colorMap = {
        blue: '#0d6efd',
        green: '#28a745',
        purple: '#6f42c1',
        orange: '#fd7e14',
        red: '#dc3545',
        teal: '#20c997'
    };
    
    // 獲取 favicon SVG
    const favicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (favicon) {
        // 創建新的 SVG 與更新的顏色
        const newFaviconUrl = `data:image/svg+xml,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
                <g transform="translate(64, 64)">
                    <circle cx="-8" cy="-8" r="32" fill="rgba(255,255,255,0.1)" stroke="${colorMap[color]}" stroke-width="8"/>
                    <line x1="-8" y1="-32" x2="-8" y2="16" stroke="${colorMap[color]}" stroke-width="3" opacity="0.3"/>
                    <line x1="-32" y1="-8" x2="16" y2="-8" stroke="${colorMap[color]}" stroke-width="3" opacity="0.3"/>
                    <circle cx="-8" cy="-8" r="5" fill="${colorMap[color]}"/>
                    <circle cx="-8" cy="-20" r="3" fill="${colorMap[color]}" opacity="0.7"/>
                    <circle cx="4" cy="-8" r="3" fill="${colorMap[color]}" opacity="0.7"/>
                    <circle cx="-20" cy="-8" r="3" fill="${colorMap[color]}" opacity="0.7"/>
                    <circle cx="-8" cy="4" r="3" fill="${colorMap[color]}" opacity="0.7"/>
                    <line x1="16" y1="16" x2="36" y2="36" stroke="${colorMap[color]}" stroke-width="10" stroke-linecap="round"/>
                </g>
            </svg>
        `)}`;
        favicon.href = newFaviconUrl;
    }
}

// === 統計面板功能 ===

// GlobalPing API 探測資料快取
let probesData = null;
let lastProbesUpdate = 0;
const PROBES_CACHE_TIME = 5 * 60 * 1000; // 5分鐘快取

// 初始化統計面板
function initStatsPanel() {
    const statsBtn = document.getElementById('statsBtn');
    const refreshStatsBtn = document.getElementById('refreshStats');
    
    // 綁定統計按鈕事件
    if (statsBtn) {
        statsBtn.addEventListener('click', showStatsModal);
    }
    
    // 綁定刷新按鈕事件
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', refreshStats);
    }
}

// 顯示統計模態框
async function showStatsModal() {
    const modal = document.getElementById('statsModal');
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    
    // 添加事件監聽器為統計面板背景添加標識
    modal.addEventListener('shown.bs.modal', () => {
        const backdrop = document.querySelector('.modal-backdrop.show');
        if (backdrop) {
            backdrop.setAttribute('data-stats-backdrop', 'true');
        }
    }, { once: true });
    
    modalInstance.show();
    
    // 載入統計數據
    await loadStats();
}

// 獲取 GlobalPing probes 數據
async function fetchProbesData() {
    const now = Date.now();
    
    // 檢查快取
    if (probesData && (now - lastProbesUpdate) < PROBES_CACHE_TIME) {
        return probesData;
    }
    
    try {
        const response = await fetch('https://api.globalping.io/v1/probes');
        const data = await response.json();
        probesData = data;
        lastProbesUpdate = now;
        return data;
    } catch (error) {
        console.error('獲取 probes 數據失敗:', error);
        return null;
    }
}

// 載入統計數據
async function loadStats() {
    try {
        // 獲取 probes 數據
        const probes = await fetchProbesData();
        if (!probes) {
            showStatsError('無法獲取節點數據');
            return;
        }
        
        // 計算統計數據
        const stats = calculateStats(probes);
        
        // 更新 UI
        updateStatsUI(stats);
        
    } catch (error) {
        console.error('載入統計數據失敗:', error);
        showStatsError('載入統計數據失敗');
    }
}

// 計算統計數據
function calculateStats(probes) {
    const stats = {
        total: 0,
        online: 0,
        offline: 0,
        byRegion: {},
        byNetwork: {},
        nodeDetails: []
    };
    
    // 為每個節點檢查是否在線
    for (const node of nodesData.nodes) {
        stats.total++;
        
        // 在 probes 中查找匹配的節點
        const matchingProbes = probes.filter(probe => {
            if (!probe.tags || !Array.isArray(probe.tags)) return false;
            
            // 檢查是否有匹配的 tags
            return probe.tags.some(tag => {
                if (typeof node.tags === 'string') {
                    return node.tags.includes(tag);
                } else if (Array.isArray(node.tags)) {
                    return node.tags.includes(tag);
                }
                return false;
            });
        });
        
        // 判斷節點狀態
        const isOnline = matchingProbes.length > 0 && matchingProbes.some(probe => probe.version);
        
        if (isOnline) {
            stats.online++;
        } else {
            stats.offline++;
        }
        
        // 使用第一個匹配的 probe 來獲取詳細信息
        const primaryProbe = matchingProbes.find(probe => probe.version) || matchingProbes[0];
        
        if (primaryProbe) {
            // 地區統計
            const region = primaryProbe.location?.continent || 'Unknown';
            stats.byRegion[region] = (stats.byRegion[region] || 0) + 1;
            
            // 檢測支援的協議和網路類型
            const supportedProtocols = detectSupportedProtocols(primaryProbe);
            const networkType = getNodeNetworkType(node, primaryProbe);
            
            // 網路類型統計
            stats.byNetwork[networkType] = (stats.byNetwork[networkType] || 0) + 1;
            
            // 節點詳細信息
            stats.nodeDetails.push({
                name: node.name,
                name_zh: node.name_zh,
                location: node.location,
                location_zh: node.location_zh,
                provider: node.provider,
                providerLink: node['provider-link'],
                status: isOnline ? 'online' : 'offline',
                version: node.version || primaryProbe.version || 'N/A',
                network: primaryProbe.location?.network || 'N/A',
                asn: node.asn || primaryProbe.location?.asn || 'N/A',
                networkType: networkType,
                protocols: supportedProtocols,
                continent: node.continent, // 確保傳遞大陸資訊
                probeData: primaryProbe
            });
        } else {
            // 沒有找到匹配的 probe，標記為離線
            stats.nodeDetails.push({
                name: node.name,
                name_zh: node.name_zh,
                location: node.location,
                location_zh: node.location_zh,
                provider: node.provider,
                providerLink: node['provider-link'],
                status: 'offline',
                version: node.version || 'N/A',
                network: 'N/A',
                asn: node.asn || 'N/A',
                networkType: getNodeNetworkType(node, null),
                protocols: ['未知'],
                continent: node.continent, // 確保傳遞大陸資訊
                probeData: null
            });
        }
    }
    
    return stats;
}


// 獲取節點網路類型（優先使用自定義類型）
function getNodeNetworkType(node, probe) {
    // 優先使用 nodes.json 中定義的自定義網路類型
    if (node.networkType) {
        return node.networkType;
    }
    
    // 基於節點名稱和提供者的自定義映射
    const customNetworkTypes = getCustomNetworkTypeMapping();
    const nodeKey = `${node.name}-${node.location}`;
    
    if (customNetworkTypes[nodeKey]) {
        return customNetworkTypes[nodeKey];
    }
    
    // 基於提供者的映射
    if (customNetworkTypes[node.provider]) {
        return customNetworkTypes[node.provider];
    }
    
    // 回退到自動檢測
    return detectNetworkType(probe?.tags);
}

// 自訂網路類型映射表
function getCustomNetworkTypeMapping() {
    return {
        // 基於節點名稱和位置的映射
        'CDX-NCHC-Tainan': '教育網路',
        'DaDa-Chief-New Taipei City': '家庭寬頻',
        'DaDa-FET-New Taipei City': '家庭寬頻',
        'CoCoDigit-Taipei': '資料中心',
        'FET-New Taipei City': '電信商',
        'HINET-Taichung': '電信商',
        'Kbro-TFN-Pingtung': '有線電視',
        'NCSE Network-Taipei': '資料中心',
        'TANET-Yilan': '教育網路',
        'TINP-Taichung': '資料中心',
        'Simple Information-Taipei': '資料中心',
        'Simple Information-Hong Kong': '資料中心',
        'Simple Information-United States': '資料中心',
        'VeeTIME-Taichung': '有線電視',
        
        // 基於提供者的映射
        'Yuan': '個人維護',
        'CH': '個人維護',
        'Zhuyuan': '個人維護',
        'CoCoDigit': '資料中心',
        'NCSE Network': '資料中心',
        'cute_panda': '個人維護',
        'Ricky': '資料中心',
        'Cheese_ge': '個人維護'
    };
}

// 檢測網路類型（原始自動檢測功能）
function detectNetworkType(tags) {
    if (!tags || !Array.isArray(tags)) return '未知';
    
    const tagStr = tags.join(' ').toLowerCase();
    
    if (tagStr.includes('datacenter') || tagStr.includes('vps') || tagStr.includes('cloud')) {
        return '資料中心';
    } else if (tagStr.includes('residential') || tagStr.includes('home')) {
        return '家庭寬頻';
    } else if (tagStr.includes('business') || tagStr.includes('corporate')) {
        return '企業網路';
    } else if (tagStr.includes('mobile') || tagStr.includes('cellular')) {
        return '行動網路';
    } else if (tagStr.includes('university') || tagStr.includes('education')) {
        return '教育網路';
    }
    
    return '其他';
}

// 檢測支援的協議
function detectSupportedProtocols(probe) {
    if (!probe) {
        return ['未知'];
    }
    
    const protocols = [];
    let hasIPv4 = false;
    let hasIPv6 = false;
    
    // 檢查 resolvers 來判斷支援的協議
    if (probe.resolvers && Array.isArray(probe.resolvers)) {
        probe.resolvers.forEach(resolver => {
            // IPv4 地址格式檢測
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(resolver)) {
                hasIPv4 = true;
            }
            // IPv6 地址格式檢測
            else if (resolver.includes(':') && (
                resolver.includes('::') || // 縮寫格式
                /^[0-9a-fA-F:]+$/.test(resolver) // 完整格式
            )) {
                hasIPv6 = true;
            }
            // 常見的 IPv6 DNS 服務器
            else if (resolver === '2001:4860:4860::8888' || // Google IPv6 DNS
                     resolver === '2001:4860:4860::8844' ||
                     resolver.startsWith('2001:') ||
                     resolver.startsWith('2400:') ||
                     resolver.startsWith('2a00:') ||
                     resolver.startsWith('2606:')) {
                hasIPv6 = true;
            }
        });
    }
    
    // 檢查 tags 中是否有 IPv6 相關標記
    if (probe.tags && Array.isArray(probe.tags)) {
        const tagStr = probe.tags.join(' ').toLowerCase();
        
        if (tagStr.includes('ipv6') || 
            tagStr.includes('dual-stack') || 
            tagStr.includes('dualstack') ||
            tagStr.includes('v6')) {
            hasIPv6 = true;
        }
        
        // 如果沒有明確的 IPv4 檢測，但有網路相關標記，預設支援 IPv4
        if (!hasIPv4 && (tagStr.includes('datacenter') || tagStr.includes('network') || tagStr.includes('isp'))) {
            hasIPv4 = true;
        }
    }
    
    // 檢查位置信息中是否有 IPv6 支援的跡象
    if (probe.location && probe.location.network) {
        const networkStr = probe.location.network.toLowerCase();
        if (networkStr.includes('ipv6') || networkStr.includes('dual') || networkStr.includes('v6')) {
            hasIPv6 = true;
        }
    }
    
    // 如果都沒有明確檢測到，預設支援 IPv4
    if (!hasIPv4 && !hasIPv6) {
        hasIPv4 = true;
    }
    
    // 建立協議列表
    if (hasIPv4) protocols.push('IPv4');
    if (hasIPv6) protocols.push('IPv6');
    
    return protocols.length > 0 ? protocols : ['IPv4'];
}

// 格式化協議顯示
function formatProtocols(protocols) {
    if (!protocols || protocols.length === 0) {
        return '<span class="badge bg-secondary">未知</span>';
    }
    
    return protocols.map(protocol => {
        if (protocol === 'IPv4') {
            return '<span class="badge bg-primary me-1">IPv4</span>';
        } else if (protocol === 'IPv6') {
            return '<span class="badge bg-success me-1">IPv6</span>';
        } else {
            return `<span class="badge bg-secondary me-1">${protocol}</span>`;
        }
    }).join('');
}

// 更新統計 UI
function updateStatsUI(stats) {
    // 更新概覽卡片
    document.getElementById('totalNodesCount').textContent = stats.total;
    document.getElementById('onlineNodesCount').textContent = stats.online;
    document.getElementById('offlineNodesCount').textContent = stats.offline;
    
    const onlinePercentage = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
    document.getElementById('onlinePercentage').textContent = `${onlinePercentage}%`;
    
    // 更新地區分布
    updateRegionStats(stats.byRegion);
    
    // 更新網路類型分布
    updateNetworkStats(stats.byNetwork);
    
    // 更新節點詳細列表
    updateNodeDetailsList(stats.nodeDetails);
    
    // 更新地理分布統計
    updateGeographicStats(stats);
    
    // 更新最後更新時間
    const now = new Date();
    document.getElementById('lastUpdateTime').textContent = 
        `最後更新：${now.toLocaleTimeString('zh-TW')}`;
}

// 更新地區統計
function updateRegionStats(regionData) {
    const container = document.getElementById('regionStats');
    const total = Object.values(regionData).reduce((sum, count) => sum + count, 0);
    
    // 地區名稱映射
    const regionNames = {
        'AS': '亞洲',
        'EU': '歐洲',
        'NA': '北美洲',
        'SA': '南美洲',
        'OC': '大洋洲',
        'AF': '非洲',
        'Unknown': '未知'
    };
    
    const html = Object.entries(regionData)
        .sort((a, b) => b[1] - a[1])
        .map(([region, count]) => {
            const percentage = Math.round((count / total) * 100);
            const regionName = regionNames[region] || region;
            return `
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span>${regionName}</span>
                    <div class="d-flex align-items-center">
                        <div class="progress me-2" style="width: 100px; height: 6px;">
                            <div class="progress-bar" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-muted">${count} (${percentage}%)</span>
                    </div>
                </div>
            `;
        }).join('');
    
    container.innerHTML = html || '<div class="text-muted text-center">無數據</div>';
}

// 更新網路類型統計
function updateNetworkStats(networkData) {
    const container = document.getElementById('networkStats');
    const total = Object.values(networkData).reduce((sum, count) => sum + count, 0);
    
    const html = Object.entries(networkData)
        .sort((a, b) => b[1] - a[1])
        .map(([network, count]) => {
            const percentage = Math.round((count / total) * 100);
            return `
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span>${network}</span>
                    <div class="d-flex align-items-center">
                        <div class="progress me-2" style="width: 100px; height: 6px;">
                            <div class="progress-bar" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-muted">${count} (${percentage}%)</span>
                    </div>
                </div>
            `;
        }).join('');
    
    container.innerHTML = html || '<div class="text-muted text-center">無數據</div>';
}

// 更新節點詳細列表
function updateNodeDetailsList(nodeDetails) {
    const tbody = document.getElementById('nodeDetailsList');
    
    const html = nodeDetails
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(node => {
            const statusBadge = node.status === 'online' 
                ? '<span class="badge bg-success me-2">連線</span>'
                : '<span class="badge bg-danger me-2">斷線</span>';
            
            const locationText = node.location_zh 
                ? `${node.location_zh}<br><small class="text-muted">${node.location}</small>`
                : node.location;
            
            return `
                <tr>
                    <td>
                        ${node.name}
                        ${node.name_zh ? `<br><small class="text-muted">${node.name_zh}</small>` : ''}
                    </td>
                    <td>${locationText}</td>
                    <td>
                        <a href="${node.providerLink}" target="_blank" class="text-decoration-none">
                            ${node.provider}
                        </a>
                    </td>
                    <td>${statusBadge}</td>
                    <td>${node.asn}</td>
                    <td>${node.networkType}</td>
                </tr>
            `;
        }).join('');
    
    tbody.innerHTML = html || '<tr><td colspan="6" class="text-center text-muted">無數據</td></tr>';
}

// 顯示統計錯誤
function showStatsError(message) {
    ['regionStats', 'networkStats', 'nodeDetailsList'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = `<div class="text-center text-danger">${message}</div>`;
        }
    });
}

// 刷新統計數據
async function refreshStats() {
    // 清除快取
    lastProbesUpdate = 0;
    
    // 顯示載入中
    ['regionStats', 'networkStats'].forEach(id => {
        document.getElementById(id).innerHTML = `
            <div class="text-center text-muted">
                <div class="spinner-border spinner-border-sm" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
            </div>
        `;
    });
    
    document.getElementById('nodeDetailsList').innerHTML = `
        <tr>
            <td colspan="6" class="text-center text-muted">
                <div class="spinner-border spinner-border-sm" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
            </td>
        </tr>
    `;
    
    // 重新載入數據
    await loadStats();
}


// 更新地理分布統計
function updateGeographicStats(stats) {
    const allNodes = stats.nodeDetails;
    
    // 按五大洲分類統計
    const continentStats = {
        asia: 0,
        europe: 0,
        northAmerica: 0,
        southAmerica: 0,
        oceania: 0,
        africa: 0
    };
    
    allNodes.forEach(node => {
        const continent = getNodeContinent(node);
        continentStats[continent]++;
    });
    
    // 更新 UI
    document.getElementById('asiaNodes').textContent = continentStats.asia;
    document.getElementById('europeNodes').textContent = continentStats.europe;
    document.getElementById('northAmericaNodes').textContent = continentStats.northAmerica;
    document.getElementById('southAmericaNodes').textContent = continentStats.southAmerica;
    document.getElementById('oceaniaNodes').textContent = continentStats.oceania;
    document.getElementById('africaNodes').textContent = continentStats.africa;
}


// 從 probe 資料檢測洲別
function detectContinentFromProbe(probe) {
    if (!probe.location) return 'asia';
    
    const continent = probe.location.continent;
    
    // GlobalPing API 的洲別對應
    const continentMapping = {
        'AS': 'asia',
        'EU': 'europe', 
        'NA': 'northAmerica',
        'SA': 'southAmerica',
        'OC': 'oceania',
        'AF': 'africa'
    };
    
    return continentMapping[continent] || 'asia';
}

// 從 probe 資料檢測網路類型
function detectNetworkTypeFromProbe(probe) {
    if (!probe.tags || !Array.isArray(probe.tags)) return '未知';
    
    const tagStr = probe.tags.join(' ').toLowerCase();
    
    if (tagStr.includes('datacenter') || tagStr.includes('vps') || tagStr.includes('cloud')) {
        return '資料中心';
    } else if (tagStr.includes('residential') || tagStr.includes('home')) {
        return '家庭寬頻';
    } else if (tagStr.includes('business') || tagStr.includes('corporate')) {
        return '企業網路';
    } else if (tagStr.includes('mobile') || tagStr.includes('cellular')) {
        return '行動網路';
    } else if (tagStr.includes('university') || tagStr.includes('education')) {
        return '教育網路';
    }
    
    return '其他';
}

// 顯示更新結果
function showUpdateResult(updatedData) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'updateResultModal';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">節點資料更新結果</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-success">
                        <i class="bi bi-check-circle me-2"></i>
                        成功從 GlobalPing API 更新節點資料！
                    </div>
                    <p><strong>更新時間：</strong>${new Date().toLocaleString('zh-TW')}</p>
                    <p><strong>節點數量：</strong>${updatedData.nodes.length} 個</p>
                    
                    <div class="mb-3">
                        <label class="form-label">更新後的 nodes.json 內容：</label>
                        <textarea class="form-control" rows="15" readonly id="updatedJSON">${JSON.stringify(updatedData, null, 2)}</textarea>
                    </div>
                    
                    <div class="alert alert-warning">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        請複製上方內容並手動更新 nodes.json 檔案
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="copyToClipboard(event)">
                        <i class="bi bi-clipboard"></i> 複製到剪貼簿
                    </button>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">關閉</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
    
    // 清理 modal
    modal.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modal);
    });
}

// 複製到剪貼簿
async function copyToClipboard(event) {
    const textarea = document.getElementById('updatedJSON');
    
    try {
        await navigator.clipboard.writeText(textarea.value);
        
        // 顯示複製成功提示
        const btn = event.target.closest('button');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check"></i> 已複製';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }, 2000);
    } catch (err) {
        // 降級到舊方法
        textarea.select();
        textarea.setSelectionRange(0, 99999);
        document.execCommand('copy');
        
        const btn = event.target.closest('button');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check"></i> 已複製';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }, 2000);
    }
}

// 根據節點判斷所屬洲別
function getNodeContinent(node) {
    // 優先使用 nodes.json 中定義的洲別
    if (node.continent) {
        // 統一洲別命名
        const continentMap = {
            'Asia': 'asia',
            'asia': 'asia',
            'Europe': 'europe',
            'europe': 'europe',
            'northAmerica': 'northAmerica',
            'NorthAmerica': 'northAmerica',
            'southAmerica': 'southAmerica',
            'SouthAmerica': 'southAmerica',
            'oceania': 'oceania',
            'Oceania': 'oceania',
            'africa': 'africa',
            'Africa': 'africa'
        };
        return continentMap[node.continent] || node.continent;
    }
    
    const location = node.location.toLowerCase();
    const location_zh = node.location_zh?.toLowerCase() || '';
    
    // 亞洲
    if (node.location_zh || // 有中文位置通常是亞洲（台灣）
        location.includes('hong kong') || location_zh.includes('香港') ||
        location.includes('japan') || location.includes('korea') || 
        location.includes('singapore') || location.includes('china') ||
        location.includes('india') || location.includes('thailand') ||
        location.includes('vietnam') || location.includes('malaysia') ||
        location.includes('indonesia') || location.includes('philippines') ||
        location.includes('taiwan') || location.includes('tainan') ||
        location.includes('taipei') || location.includes('taichung') ||
        location.includes('pingtung') || location.includes('yilan')) {
        return 'asia';
    }
    
    // 北美洲
    if (location.includes('united states') || location.includes('usa') ||
        location.includes('canada') || location.includes('mexico')) {
        return 'northAmerica';
    }
    
    // 歐洲
    if (location.includes('europe') || location.includes('united kingdom') ||
        location.includes('germany') || location.includes('france') ||
        location.includes('netherlands') || location.includes('poland') ||
        location.includes('spain') || location.includes('italy') ||
        location.includes('sweden') || location.includes('norway') ||
        location.includes('finland') || location.includes('denmark') ||
        location.includes('belgium') || location.includes('austria') ||
        location.includes('switzerland') || location.includes('russia')) {
        return 'europe';
    }
    
    // 南美洲
    if (location.includes('brazil') || location.includes('argentina') ||
        location.includes('chile') || location.includes('colombia') ||
        location.includes('peru') || location.includes('venezuela')) {
        return 'southAmerica';
    }
    
    // 大洋洲
    if (location.includes('australia') || location.includes('new zealand') ||
        location.includes('fiji') || location.includes('papua new guinea')) {
        return 'oceania';
    }
    
    // 非洲
    if (location.includes('africa') || location.includes('south africa') ||
        location.includes('egypt') || location.includes('nigeria') ||
        location.includes('morocco') || location.includes('kenya')) {
        return 'africa';
    }
    
    // 預設為亞洲（因為目前節點主要在亞洲）
    return 'asia';
}


// 測試節點響應時間
async function testNodesResponseTime(nodes) {
    const results = [];
    
    // 只測試前3個在線節點，避免過多的 API 請求
    const testNodes = nodes.slice(0, 3);
    
    for (const node of testNodes) {
        try {
            const startTime = Date.now();
            
            // 找到對應的原始節點資料來獲取正確的 tags
            const originalNode = nodesData.nodes.find(n => n.name === node.name);
            if (!originalNode || !originalNode.tags) {
                console.warn(`無法找到節點 ${node.name} 的 tags`);
                continue;
            }
            
            // 發送簡單的測試請求
            const response = await fetch('https://api.globalping.io/v1/measurements', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'ping',
                    target: '8.8.8.8',
                    limit: 1,
                    locations: [{
                        magic: originalNode.tags
                    }]
                })
            });
            
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            if (response.ok) {
                const data = await response.json();
                // 檢查是否成功創建了測量
                if (data.id) {
                    results.push({
                        node: node,
                        time: responseTime
                    });
                }
            }
        } catch (error) {
            console.error(`測試節點 ${node.name} 失敗:`, error);
        }
    }
    
    return results;
}

// 確定最佳可用節點
function determineBestNode(onlineNodes) {
    // 簡單的評分系統
    const scored = onlineNodes.map(node => {
        let score = 0;
        
        // 數據中心網路加分
        if (node.probeData?.tags?.some(tag => 
            ['datacenter', 'vps', 'cloud'].some(keyword => tag.includes(keyword))
        )) {
            score += 10;
        }
        
        // 版本越新越好
        if (node.version && node.version !== 'N/A') {
            const versionNum = parseFloat(node.version.replace(/[^0-9.]/g, ''));
            if (!isNaN(versionNum)) {
                score += versionNum;
            }
        }
        
        return { node, score };
    });
    
    // 返回得分最高的節點
    return scored.sort((a, b) => b.score - a.score)[0]?.node || onlineNodes[0];
}


// 檢查主畫面節點狀態
async function checkMainNodeStatus() {
    const statusChecks = nodesData.nodes.map(async (node, index) => {
        const statusIndicator = document.getElementById(`main_status_${index}`);
        
        try {
            // 發送快速測試請求檢查節點是否線上
            const testResponse = await fetch('https://api.globalping.io/v1/measurements', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'ping',
                    target: '8.8.8.8',
                    limit: 1,
                    locations: [{
                        magic: node.tags
                    }]
                })
            });
            
            const data = await testResponse.json();
            
            if (data.id) {
                // 節點線上
                statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-success" title="線上"></i>';
            } else {
                // 節點可能離線
                statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-danger" title="離線"></i>';
            }
        } catch (error) {
            // 檢查失敗，顯示警告
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-warning" title="狀態未知"></i>';
            console.warn(`節點 ${node.name} 狀態檢查失敗:`, error);
        }
    });
    
    // 等待所有狀態檢查完成
    await Promise.allSettled(statusChecks);
}


 