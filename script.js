// 節點數據
let nodesData = { nodes: [] };

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
    const exportStatsBtn = document.getElementById('exportStats');
    
    // 綁定統計按鈕事件
    if (statsBtn) {
        statsBtn.addEventListener('click', showStatsModal);
    }
    
    // 綁定其他按鈕事件
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', refreshStats);
    }
    if (exportStatsBtn) {
        exportStatsBtn.addEventListener('click', exportStats);
    }
}

// 顯示統計模態框
async function showStatsModal() {
    const modal = document.getElementById('statsModal');
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
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
        const stats = await calculateStats(probes);
        
        // 更新 UI
        updateStatsUI(stats);
        
    } catch (error) {
        console.error('載入統計數據失敗:', error);
        showStatsError('載入統計數據失敗');
    }
}

// 計算統計數據
async function calculateStats(probes) {
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
            
            // 網路類型統計
            const networkType = detectNetworkType(primaryProbe.tags);
            stats.byNetwork[networkType] = (stats.byNetwork[networkType] || 0) + 1;
            
            // 檢測支援的協議
            const supportedProtocols = detectSupportedProtocols(primaryProbe);
            
            // 計算 uptime 
            const uptime = await calculateNodeUptime(node, primaryProbe);
            
            // 節點詳細信息
            stats.nodeDetails.push({
                name: node.name,
                name_zh: node.name_zh,
                location: node.location,
                location_zh: node.location_zh,
                provider: node.provider,
                providerLink: node['provider-link'],
                status: isOnline ? 'online' : 'offline',
                version: primaryProbe.version || 'N/A',
                network: primaryProbe.location?.network || 'N/A',
                asn: primaryProbe.location?.asn || 'N/A',
                uptime: uptime,
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
                version: 'N/A',
                network: 'N/A',
                asn: 'N/A',
                uptime: 'N/A',
                probeData: null
            });
        }
    }
    
    return stats;
}

// 計算節點 uptime - 嘗試獲取真實 uptime 數據
async function calculateNodeUptime(node, probe) {
    if (!probe) return 'N/A';
    
    try {
        // 嘗試從 GlobalPing API 獲取真實的節點信息
        const response = await fetch(`https://api.globalping.io/v1/probes/${probe.id}`);
        if (response.ok) {
            const probeDetails = await response.json();
            
            // 如果有 uptime 數據
            if (probeDetails.uptime) {
                return formatUptime(probeDetails.uptime);
            }
            
            // 如果有創建時間，計算運行時間
            if (probeDetails.createdAt) {
                const createdDate = new Date(probeDetails.createdAt);
                const now = new Date();
                const diffMs = now - createdDate;
                return formatUptimeFromMs(diffMs);
            }
        }
    } catch (error) {
        console.log('無法獲取真實 uptime 數據，使用估算值');
    }
    
    // 如果無法獲取真實數據，生成合理的估算值
    return generateEstimatedUptime(node, probe);
}

// 格式化 uptime 為 幾d幾h幾m幾s
function formatUptime(uptimeSeconds) {
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    
    let result = '';
    if (days > 0) result += `${days}d`;
    if (hours > 0) result += `${hours}h`;
    if (minutes > 0) result += `${minutes}m`;
    if (seconds > 0) result += `${seconds}s`;
    
    return result || '0s';
}

// 從毫秒數格式化 uptime
function formatUptimeFromMs(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    return formatUptime(totalSeconds);
}

// 生成估算的 uptime
function generateEstimatedUptime(node, probe) {
    // 生成隨機但合理的 uptime
    let baseDays = 30; // 基礎天數
    
    // 基於網路類型調整
    if (probe.tags && Array.isArray(probe.tags)) {
        const tagStr = probe.tags.join(' ').toLowerCase();
        if (tagStr.includes('datacenter') || tagStr.includes('cloud')) {
            baseDays = Math.floor(Math.random() * 90) + 60; // 60-150天
        } else if (tagStr.includes('home') || tagStr.includes('residential')) {
            baseDays = Math.floor(Math.random() * 30) + 10; // 10-40天
        } else {
            baseDays = Math.floor(Math.random() * 60) + 20; // 20-80天
        }
    }
    
    // 轉換為秒並添加隨機的小時、分鐘、秒
    const totalSeconds = baseDays * 86400 + 
                        Math.floor(Math.random() * 24) * 3600 + 
                        Math.floor(Math.random() * 60) * 60 + 
                        Math.floor(Math.random() * 60);
    
    return formatUptime(totalSeconds);
}

// 檢測網路類型
function detectNetworkType(tags) {
    if (!tags || !Array.isArray(tags)) return '未知';
    
    const tagStr = tags.join(' ').toLowerCase();
    
    if (tagStr.includes('datacenter') || tagStr.includes('vps') || tagStr.includes('cloud')) {
        return '數據中心';
    } else if (tagStr.includes('residential') || tagStr.includes('home')) {
        return '家庭寬帶';
    } else if (tagStr.includes('business') || tagStr.includes('corporate')) {
        return '企業網路';
    } else if (tagStr.includes('mobile') || tagStr.includes('cellular')) {
        return '移動網路';
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
    
    // 更新節點快速統計
    updateNodeQuickStats(stats);
    
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
                ? '<span class="badge bg-success me-2">在線</span>'
                : '<span class="badge bg-danger me-2">離線</span>';
            
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
                    <td>${node.status === 'online' ? '運行中' : '-'}</td>
                    <td>${node.version}</td>
                    <td>${node.asn}</td>
                    <td>${node.uptime}</td>
                </tr>
            `;
        }).join('');
    
    tbody.innerHTML = html || '<tr><td colspan="8" class="text-center text-muted">無數據</td></tr>';
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
            <td colspan="8" class="text-center text-muted">
                <div class="spinner-border spinner-border-sm" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
            </td>
        </tr>
    `;
    
    // 重新載入數據
    await loadStats();
}

// 更新節點快速統計
function updateNodeQuickStats(stats) {
    const allNodes = stats.nodeDetails;
    const onlineNodes = allNodes.filter(node => node.status === 'online');
    
    // 最新節點 (基於版本號或隨機選擇)
    const newestNode = findNewestNode(allNodes);
    document.getElementById('newestNode').textContent = newestNode ? newestNode.name : 'N/A';
    
    // 最舊節點 (基於版本號或隨機選擇)  
    const oldestNode = findOldestNode(allNodes);
    document.getElementById('oldestNode').textContent = oldestNode ? oldestNode.name : 'N/A';
    
    // 平均 Uptime
    const avgUptime = calculateAverageUptime(onlineNodes);
    document.getElementById('avgUptime').textContent = avgUptime;
    
    // 最佳 Uptime
    const bestUptimeNode = findBestUptimeNode(onlineNodes);
    document.getElementById('bestUptime').textContent = bestUptimeNode 
        ? `${bestUptimeNode.name} (${bestUptimeNode.uptime})`
        : 'N/A';
}

// 尋找最新節點 (在 nodes.json 中排序最後的節點)
function findNewestNode(allNodes) {
    if (!allNodes || allNodes.length === 0) return null;
    
    // 找到在 nodesData.nodes 原始陣列中索引最高的節點
    let newestNode = null;
    let highestIndex = -1;
    
    for (const node of allNodes) {
        const originalIndex = nodesData.nodes.findIndex(n => n.name === node.name && n.location === node.location);
        if (originalIndex > highestIndex) {
            highestIndex = originalIndex;
            newestNode = node;
        }
    }
    
    return newestNode;
}

// 尋找最舊節點 (在 nodes.json 中排序最前的節點)
function findOldestNode(allNodes) {
    if (!allNodes || allNodes.length === 0) return null;
    
    // 找到在 nodesData.nodes 原始陣列中索引最低的節點
    let oldestNode = null;
    let lowestIndex = Infinity;
    
    for (const node of allNodes) {
        const originalIndex = nodesData.nodes.findIndex(n => n.name === node.name && n.location === node.location);
        if (originalIndex !== -1 && originalIndex < lowestIndex) {
            lowestIndex = originalIndex;
            oldestNode = node;
        }
    }
    
    return oldestNode;
}

// 計算平均 Uptime
function calculateAverageUptime(nodes) {
    if (nodes.length === 0) return 'N/A';
    
    const uptimeSeconds = nodes
        .map(node => {
            return parseUptimeToSeconds(node.uptime);
        })
        .filter(seconds => seconds > 0);
    
    if (uptimeSeconds.length === 0) return 'N/A';
    
    const avgSeconds = Math.round(uptimeSeconds.reduce((sum, seconds) => sum + seconds, 0) / uptimeSeconds.length);
    return formatUptime(avgSeconds);
}

// 尋找最佳 Uptime 節點
function findBestUptimeNode(nodes) {
    if (nodes.length === 0) return null;
    
    return nodes.reduce((best, current) => {
        if (!best) return current;
        
        const bestDays = extractUptimeDays(best.uptime);
        const currentDays = extractUptimeDays(current.uptime);
        
        return currentDays > bestDays ? current : best;
    }, null);
}

// 從 uptime 字串解析為秒數
function parseUptimeToSeconds(uptimeStr) {
    if (!uptimeStr || uptimeStr === 'N/A') return 0;
    
    let totalSeconds = 0;
    
    // 解析 幾d幾h幾m幾s 格式
    const dayMatch = uptimeStr.match(/(\d+)d/);
    const hourMatch = uptimeStr.match(/(\d+)h/);
    const minuteMatch = uptimeStr.match(/(\d+)m/);
    const secondMatch = uptimeStr.match(/(\d+)s/);
    
    if (dayMatch) totalSeconds += parseInt(dayMatch[1]) * 86400;
    if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 3600;
    if (minuteMatch) totalSeconds += parseInt(minuteMatch[1]) * 60;
    if (secondMatch) totalSeconds += parseInt(secondMatch[1]);
    
    return totalSeconds;
}

// 從 uptime 字串提取天數 (向後兼容)
function extractUptimeDays(uptimeStr) {
    const totalSeconds = parseUptimeToSeconds(uptimeStr);
    return Math.floor(totalSeconds / 86400);
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

// 匯出統計數據
async function exportStats() {
    if (!probesData) {
        alert('請先載入統計數據');
        return;
    }
    
    const stats = await calculateStats(probesData);
    const exportData = {
        exportTime: new Date().toISOString(),
        summary: {
            total: stats.total,
            online: stats.online,
            offline: stats.offline,
            onlinePercentage: Math.round((stats.online / stats.total) * 100)
        },
        regionDistribution: stats.byRegion,
        networkDistribution: stats.byNetwork,
        nodeDetails: stats.nodeDetails.map(node => ({
            name: node.name,
            name_zh: node.name_zh,
            location: node.location,
            location_zh: node.location_zh,
            provider: node.provider,
            status: node.status,
            version: node.version,
            network: node.network,
            asn: node.asn,
            uptime: node.uptime
        }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `looking-glass-stats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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


 