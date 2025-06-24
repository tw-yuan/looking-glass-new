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
    const networkTypeInfoBtn = document.getElementById('networkTypeInfo');
    
    // 綁定統計按鈕事件
    if (statsBtn) {
        statsBtn.addEventListener('click', showStatsModal);
    }
    
    // 綁定刷新按鈕事件
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', refreshStats);
    }
    
    // 綁定網路類型說明按鈕事件
    if (networkTypeInfoBtn) {
        networkTypeInfoBtn.addEventListener('click', showNetworkTypeInfo);
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
                version: primaryProbe.version || 'N/A',
                network: primaryProbe.location?.network || 'N/A',
                asn: primaryProbe.location?.asn || 'N/A',
                networkType: networkType,
                protocols: supportedProtocols,
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
                networkType: '未知',
                protocols: ['未知'],
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

// 自定義網路類型映射表
function getCustomNetworkTypeMapping() {
    return {
        // 基於節點名稱和位置的映射
        'CDX-NCHC-Tainan': '教育網路',
        'DaDa-Chief-New Taipei City': '家庭寬帶',
        'DaDa-FET-New Taipei City': '家庭寬帶',
        'CoCoDigit-Taipei': '數據中心',
        'FET-New Taipei City': '電信商',
        'HINET-Taichung': '電信商',
        'Kbro-TFN-Pingtung': '有線電視',
        'NCSE Network-Taipei': '數據中心',
        'TANET-Yilan': '教育網路',
        'TINP-Taichung': '數據中心',
        'Simple Information-Taipei': '數據中心',
        'Simple Information-Hong Kong': '數據中心',
        'Simple Information-United States': '數據中心',
        'VeeTIME-Taichung': '有線電視',
        
        // 基於提供者的映射
        'Yuan': '個人維護',
        'CH': '個人維護',
        'Zhuyuan': '個人維護',
        'CoCoDigit': '數據中心',
        'NCSE Network': '數據中心',
        'cute_panda': '個人維護',
        'Ricky': '數據中心',
        'Cheese_ge': '個人維護'
    };
}

// 檢測網路類型（原始自動檢測功能）
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
                    <td>${node.version}</td>
                    <td>${node.asn}</td>
                    <td>${node.networkType}</td>
                </tr>
            `;
        }).join('');
    
    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center text-muted">無數據</td></tr>';
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

// 顯示網路類型說明
function showNetworkTypeInfo() {
    const info = `
網路類型分類說明：

📡 電信商：中華電信(HINET)、遠傳電信(FET)等
🏠 家庭寬帶：大大寬頻等家用網路
📺 有線電視：凱擘寬頻、大台中數位等
🏫 教育網路：國網中心、臺灣學術網路等
🏢 數據中心：CoCoDigit、Simple Information等
👤 個人維護：由個人維護的節點

自定義網路類型方法：
1. 在 nodes.json 中添加 "networkType" 字段
2. 修改 script.js 中的 getCustomNetworkTypeMapping() 函數
3. 重新載入頁面即可生效

例如：
{
  "name": "MyNode",
  "networkType": "自定義類型",
  ...
}
    `;
    
    alert(info);
}

// 更新地理分布統計
function updateGeographicStats(stats) {
    const allNodes = stats.nodeDetails;
    
    // 台灣節點計算
    const taiwanLocations = ['Tainan', 'New Taipei City', 'Taipei', 'Taichung', 'Pingtung', 'Yilan'];
    const taiwanNodes = allNodes.filter(node => {
        // 檢查是否有中文位置 (通常表示台灣)
        if (node.location_zh) return true;
        // 檢查英文位置名稱
        return taiwanLocations.some(location => node.location.includes(location));
    }).length;
    
    // 亞洲節點計算 (包括台灣和香港，但不包括美國等其他地區)
    const asiaNodes = allNodes.filter(node => {
        // 先排除明確的非亞洲地區
        if (node.location.includes('United States') || 
            node.location.includes('USA') || 
            node.location_zh === '美國' ||
            node.location.includes('Europe') ||
            node.location.includes('Canada') ||
            node.location.includes('Brazil') ||
            node.location.includes('Australia')) {
            return false;
        }
        
        // 檢查是否為亞洲地區
        // 1. 有中文位置名稱 (通常是亞洲)
        if (node.location_zh) return true;
        
        // 2. 檢查香港
        if (node.location.includes('Hong Kong') || node.location_zh === '香港') return true;
        
        // 3. 檢查其他亞洲國家/地區
        const asiaKeywords = ['Japan', 'Korea', 'Singapore', 'China', 'India', 'Thailand', 'Vietnam', 'Malaysia', 'Indonesia', 'Philippines'];
        return asiaKeywords.some(keyword => node.location.includes(keyword));
    }).length;
    
    // 國際節點 (非亞洲)
    const internationalNodes = allNodes.length - asiaNodes;
    
    // 服務提供商數量
    const providers = new Set(allNodes.map(node => node.provider));
    const totalProviders = providers.size;
    
    // 更新 UI
    document.getElementById('taiwanNodes').textContent = taiwanNodes;
    document.getElementById('asiaNodes').textContent = asiaNodes;
    document.getElementById('internationalNodes').textContent = internationalNodes;
    document.getElementById('totalProviders').textContent = totalProviders;
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


 