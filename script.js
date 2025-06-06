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
        
        // 初始化批量測試功能
        initBatchTest();
        
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

// === 批量測試功能 ===

let selectedNodes = new Set();
let batchTestResults = new Map();

// 初始化批量測試功能
function initBatchTest() {
    const batchTestBtn = document.getElementById('batchTestBtn');
    const selectAllNodesBtn = document.getElementById('selectAllNodes');
    const startBatchTestBtn = document.getElementById('startBatchTest');
    const compareSelectedBtn = document.getElementById('compareSelectedBtn');
    
    // 綁定按鈕事件
    batchTestBtn.addEventListener('click', showBatchTestModal);
    selectAllNodesBtn.addEventListener('change', toggleSelectAll);
    startBatchTestBtn.addEventListener('click', startBatchTest);
    compareSelectedBtn.addEventListener('click', showCompareModal);
    
    // 綁定模態框關閉事件
    const batchModal = document.getElementById('batchTestModal');
    batchModal.addEventListener('hidden.bs.modal', clearBatchTestData);
}

// 顯示批量測試模態框
function showBatchTestModal() {
    const modal = document.getElementById('batchTestModal');
    generateNodeSelectionList();
    checkNodeStatus(); // 檢查節點狀態
    
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    modalInstance.show();
}

// 清除批量測試資料
function clearBatchTestData() {
    // 清除所有測試結果
    batchTestResults.clear();
    selectedResults.clear();
    selectedNodes.clear();
    
    // 重置 UI
    const resultsContainer = document.getElementById('batchResults');
    resultsContainer.className = 'batch-results flex-grow-1 d-flex align-items-center justify-content-center';
    resultsContainer.innerHTML = `
        <div class="text-center text-muted">
            <i class="bi bi-speedometer2 fs-1 mb-3"></i>
            <p>選擇要測試的節點並點擊「開始批量測試」</p>
        </div>
    `;
    
    // 重置進度顯示
    const progressElement = document.getElementById('batchProgress');
    progressElement.textContent = '選擇節點並開始測試';
    
    // 隱藏比較按鈕
    const compareBtn = document.getElementById('compareSelectedBtn');
    compareBtn.style.display = 'none';
    
    // 重置表單
    document.getElementById('batchTarget').value = '';
    document.getElementById('batchTestType').value = 'mtr';
    
    // 取消所有選擇
    document.querySelectorAll('.node-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    document.getElementById('selectAllNodes').checked = false;
    document.getElementById('selectAllNodes').indeterminate = false;
    
    // 重置開始按鈕
    const startBtn = document.getElementById('startBatchTest');
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i>請選擇節點';
}

// 生成節點選擇列表
function generateNodeSelectionList() {
    const container = document.getElementById('nodeSelectionList');
    container.innerHTML = '';
    
    nodesData.nodes.forEach((node, index) => {
        const nodeItem = document.createElement('div');
        nodeItem.className = 'node-selection-item';
        
        nodeItem.innerHTML = `
            <div class="form-check d-flex align-items-center">
                <input class="form-check-input node-checkbox" type="checkbox" 
                       id="node_${index}" data-node-index="${index}">
                <label class="form-check-label flex-grow-1" for="node_${index}">
                    <div class="fw-medium">${node.name}</div>
                    <div class="small text-muted">
                        ${node.name_zh ? node.name_zh + ' • ' : ''}${node.location_zh || node.location}
                    </div>
                </label>
                <div class="node-status-indicator" id="status_${index}">
                    <div class="spinner-border spinner-border-sm text-muted" role="status">
                        <span class="visually-hidden">檢查中...</span>
                    </div>
                </div>
            </div>
        `;
        
        const checkbox = nodeItem.querySelector('.node-checkbox');
        checkbox.addEventListener('change', updateSelectedNodes);
        
        container.appendChild(nodeItem);
    });
}

// 更新選中的節點
function updateSelectedNodes() {
    selectedNodes.clear();
    const checkboxes = document.querySelectorAll('.node-checkbox:checked');
    checkboxes.forEach(checkbox => {
        selectedNodes.add(parseInt(checkbox.dataset.nodeIndex));
    });
    
    // 更新全選按鈕狀態
    const selectAllBtn = document.getElementById('selectAllNodes');
    const totalNodes = nodesData.nodes.length;
    selectAllBtn.indeterminate = selectedNodes.size > 0 && selectedNodes.size < totalNodes;
    selectAllBtn.checked = selectedNodes.size === totalNodes;
    
    // 更新開始測試按鈕狀態
    const startBtn = document.getElementById('startBatchTest');
    startBtn.disabled = selectedNodes.size === 0;
    startBtn.innerHTML = selectedNodes.size === 0 
        ? '<i class="bi bi-play-fill me-1"></i>請選擇節點'
        : `<i class="bi bi-play-fill me-1"></i>開始測試 (${selectedNodes.size} 個節點)`;
}

// 全選/取消全選
function toggleSelectAll() {
    const selectAllBtn = document.getElementById('selectAllNodes');
    const checkboxes = document.querySelectorAll('.node-checkbox');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllBtn.checked;
    });
    
    updateSelectedNodes();
}

// 開始批量測試
async function startBatchTest() {
    const target = document.getElementById('batchTarget').value.trim();
    const testType = document.getElementById('batchTestType').value;
    
    if (!target) {
        alert('請輸入目標主機');
        return;
    }
    
    if (selectedNodes.size === 0) {
        alert('請選擇至少一個節點');
        return;
    }
    
    // 重置結果容器
    batchTestResults.clear();
    const resultsContainer = document.getElementById('batchResults');
    resultsContainer.className = 'batch-results';
    resultsContainer.innerHTML = '';
    updateUIAfterTestStart();
    
    // 更新進度顯示
    const progressElement = document.getElementById('batchProgress');
    progressElement.textContent = `測試進行中... (0/${selectedNodes.size})`;
    
    // 禁用開始按鈕
    const startBtn = document.getElementById('startBatchTest');
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>測試中...';
    
    let completedCount = 0;
    
    // 為每個選中的節點創建測試項目
    const testPromises = Array.from(selectedNodes).map(async (nodeIndex) => {
        const node = nodesData.nodes[nodeIndex];
        const resultId = `batch_result_${nodeIndex}`;
        
        // 創建結果項目
        createBatchResultItem(node, resultId, target, testType);
        
        try {
            // 執行測試
            const result = await performSingleTest(node, target, testType, resultId);
            batchTestResults.set(resultId, result);
            updateBatchResultItem(resultId, 'completed', result);
        } catch (error) {
            console.error(`節點 ${node.name} 測試失敗:`, error);
            updateBatchResultItem(resultId, 'failed', { error: error.message });
        } finally {
            completedCount++;
            progressElement.textContent = `測試進行中... (${completedCount}/${selectedNodes.size})`;
            
            if (completedCount === selectedNodes.size) {
                progressElement.textContent = `測試完成！(${completedCount}/${selectedNodes.size})`;
                startBtn.disabled = false;
                startBtn.innerHTML = `<i class="bi bi-play-fill me-1"></i>重新測試 (${selectedNodes.size} 個節點)`;
                updateUIAfterTestStart();
            }
        }
    });
    
    // 等待所有測試完成
    await Promise.allSettled(testPromises);
}

// 創建批量測試結果項目
function createBatchResultItem(node, resultId, target, testType) {
    const resultsContainer = document.getElementById('batchResults');
    
    const resultItem = document.createElement('div');
    resultItem.className = 'batch-result-item';
    resultItem.id = resultId;
    
    resultItem.innerHTML = `
        <div class="batch-result-header">
            <span class="batch-result-status status-pending">等待中</span>
            <div class="batch-result-info">
                <strong>${node.name}</strong>
                ${node.name_zh ? `<span class="text-muted ms-1">${node.name_zh}</span>` : ''}
                <div class="small text-muted">${node.location_zh || node.location}</div>
            </div>
            <div class="batch-result-checkbox">
                <input class="form-check-input result-checkbox" type="checkbox" 
                       data-result-id="${resultId}">
            </div>
        </div>
        <div class="batch-result-content">
            <div class="text-muted">正在等待測試開始...</div>
        </div>
    `;
    
    // 添加點擊選擇功能
    resultItem.classList.add('selectable');
    resultItem.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
            handleResultClick(resultId);
        }
    });
    
    // 綁定 checkbox 事件
    const checkbox = resultItem.querySelector('.result-checkbox');
    checkbox.addEventListener('change', () => {
        updateResultSelection(resultId, checkbox.checked);
    });
    
    resultsContainer.appendChild(resultItem);
}

// 更新批量測試結果項目
function updateBatchResultItem(resultId, status, data) {
    const resultItem = document.getElementById(resultId);
    if (!resultItem) return;
    
    const statusElement = resultItem.querySelector('.batch-result-status');
    const contentElement = resultItem.querySelector('.batch-result-content');
    
    // 更新狀態
    statusElement.className = `batch-result-status status-${status}`;
    
    switch (status) {
        case 'running':
            statusElement.textContent = '測試中';
            contentElement.innerHTML = '<div class="text-muted">正在執行測試...</div>';
            break;
        case 'completed':
            statusElement.textContent = '完成';
            contentElement.innerHTML = generateBatchResultContent(data);
            break;
        case 'failed':
            statusElement.textContent = '失敗';
            contentElement.innerHTML = `<div class="text-danger">測試失敗: ${data.error}</div>`;
            break;
    }
}

// 生成批量測試結果內容
function generateBatchResultContent(data) {
    const isIPv6 = data.target.includes(':');
    
    return `
        <div class="row small">
            <div class="col-md-6">
                <p class="mb-1"><strong>網路：</strong> ${data.probe.network}</p>
                <p class="mb-1"><strong>ASN：</strong> ${data.probe.asn}</p>
                <p class="mb-1"><strong>使用協議：</strong> ${isIPv6 ? 'IPv6' : 'IPv4'}</p>
            </div>
            <div class="col-md-6">
                <p class="mb-1"><strong>目標：</strong> ${data.target}</p>
                <p class="mb-1"><strong>測試 ID：</strong> ${data.measurementId}</p>
            </div>
        </div>
        <div class="text-muted small mt-1">
            <i class="bi bi-info-circle"></i>
            IPv4/IPv6 混合環境下 ASN 資訊可能不準確
        </div>
        <div class="mt-3">
            <h6 class="small mb-2">測試輸出</h6>
            <pre class="small p-2 rounded test-output" style="max-height: 200px; overflow-y: auto; background-color: var(--pre-bg); color: var(--text-color);">${data.rawOutput}</pre>
        </div>
    `;
}

// 執行單個測試
async function performSingleTest(node, target, testType, resultId) {
    // 更新狀態為測試中
    updateBatchResultItem(resultId, 'running');
    
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
    
    // 輪詢測量結果
    let result = null;
    let attempts = 0;
    const maxAttempts = 30;
    
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
                if (result.result.status === 'finished') {
                    break;
                }
            }
        } catch (error) {
            console.error('輪詢失敗:', error);
        }
    }
    
    if (!result || result.result.status !== 'finished') {
        throw new Error('測試超時或未完成');
    }
    
    return {
        probe: result.probe,
        target: target,
        measurementId: measurementData.id,
        rawOutput: result.result.rawOutput
    };
}

// 結果項目點擊處理（簡化版）
function handleResultClick(resultId) {
    toggleResultSelection(resultId);
}

let selectedResults = new Set();

// 切換結果選擇狀態
function toggleResultSelection(resultId) {
    const checkbox = document.querySelector(`input[data-result-id="${resultId}"]`);
    checkbox.checked = !checkbox.checked;
    updateResultSelection(resultId, checkbox.checked);
}

// 更新結果選擇狀態
function updateResultSelection(resultId, isSelected) {
    const resultItem = document.getElementById(resultId);
    
    if (isSelected) {
        selectedResults.add(resultId);
        resultItem.classList.add('selected');
    } else {
        selectedResults.delete(resultId);
        resultItem.classList.remove('selected');
    }
    
    updateCompareButton();
}

// 更新比較按鈕狀態
function updateCompareButton() {
    const compareBtn = document.getElementById('compareSelectedBtn');
    const hasCompleted = batchTestResults.size > 0;
    const hasSelected = selectedResults.size > 1;
    
    if (hasCompleted) {
        compareBtn.style.display = 'block';
        compareBtn.disabled = !hasSelected;
        compareBtn.innerHTML = hasSelected 
            ? `<i class="bi bi-layout-sidebar me-1"></i>比較選中 (${selectedResults.size})`
            : '<i class="bi bi-layout-sidebar me-1"></i>選擇結果比較';
    } else {
        compareBtn.style.display = 'none';
    }
}

// 顯示比較模態框
function showCompareModal() {
    if (selectedResults.size < 2) {
        alert('請至少選擇兩個測試結果進行比較');
        return;
    }
    
    // 創建比較模態框
    createCompareModal();
}

// 創建比較模態框
function createCompareModal() {
    // 檢查是否已存在比較模態框
    let compareModal = document.getElementById('compareModal');
    if (compareModal) {
        compareModal.remove();
    }
    
    // 創建新的比較模態框
    compareModal = document.createElement('div');
    compareModal.className = 'modal fade';
    compareModal.id = 'compareModal';
    compareModal.tabIndex = -1;
    
    const selectedResultsArray = Array.from(selectedResults);
    const compareContent = selectedResultsArray.map(resultId => {
        const resultData = batchTestResults.get(resultId);
        if (!resultData) return '';
        
        const nodeIndex = parseInt(resultId.replace('batch_result_', ''));
        const node = nodesData.nodes[nodeIndex];
        
        return `
            <div class="col-md-6 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h6 class="mb-0">${node.name}</h6>
                        <small class="text-muted">${node.name_zh || ''} • ${node.location_zh || node.location}</small>
                    </div>
                    <div class="card-body">
                        ${generateBatchResultContent(resultData)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    compareModal.innerHTML = `
        <div class="modal-dialog modal-fullscreen">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">測試結果比較</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        ${compareContent}
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">關閉</button>
                    <button type="button" class="btn btn-primary" onclick="exportComparison()">
                        <i class="bi bi-download me-1"></i>匯出比較
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(compareModal);
    
    // 顯示模態框
    const modalInstance = new bootstrap.Modal(compareModal);
    modalInstance.show();
    
    // 模態框關閉時移除
    compareModal.addEventListener('hidden.bs.modal', () => {
        compareModal.remove();
    });
}

// 匯出比較結果
function exportComparison() {
    const selectedResultsArray = Array.from(selectedResults);
    const exportData = selectedResultsArray.map(resultId => {
        const resultData = batchTestResults.get(resultId);
        const nodeIndex = parseInt(resultId.replace('batch_result_', ''));
        const node = nodesData.nodes[nodeIndex];
        
        return {
            node: node.name,
            node_zh: node.name_zh,
            location: node.location_zh || node.location,
            target: resultData.target,
            network: resultData.probe.network,
            asn: resultData.probe.asn,
            rawOutput: resultData.rawOutput
        };
    });
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `looking-glass-comparison-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// 檢查節點狀態
async function checkNodeStatus() {
    const statusChecks = nodesData.nodes.map(async (node, index) => {
        const statusIndicator = document.getElementById(`status_${index}`);
        const checkbox = document.getElementById(`node_${index}`);
        
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
                checkbox.disabled = false;
            } else {
                // 節點可能離線
                statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-danger" title="離線"></i>';
                checkbox.disabled = true;
                checkbox.checked = false;
            }
        } catch (error) {
            // 檢查失敗，顯示警告
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-warning" title="狀態未知"></i>';
            console.warn(`節點 ${node.name} 狀態檢查失敗:`, error);
        }
    });
    
    // 等待所有狀態檢查完成
    await Promise.allSettled(statusChecks);
    
    // 更新選擇狀態
    updateSelectedNodes();
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

// 更新開始測試後的 UI 狀態
function updateUIAfterTestStart() {
    // 重置選擇狀態
    selectedResults.clear();
    updateCompareButton();
}


 