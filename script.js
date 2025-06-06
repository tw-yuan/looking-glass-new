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
        <div class="bg-white border border-2 rounded-3 p-4 text-center shadow-sm h-100 node-card">
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
    const colorOptions = document.querySelectorAll('.color-option');
    
    // 標記當前顏色
    colorOptions.forEach(option => {
        if (option.dataset.color === currentColor) {
            option.classList.add('active');
        }
        
        // 添加點擊事件
        option.addEventListener('click', function() {
            const newColor = this.dataset.color;
            changeThemeColor(newColor);
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
    
    // 綁定按鈕事件
    batchTestBtn.addEventListener('click', showBatchTestModal);
    selectAllNodesBtn.addEventListener('change', toggleSelectAll);
    startBatchTestBtn.addEventListener('click', startBatchTest);
}

// 顯示批量測試模態框
function showBatchTestModal() {
    const modal = document.getElementById('batchTestModal');
    generateNodeSelectionList();
    
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    modalInstance.show();
}

// 生成節點選擇列表
function generateNodeSelectionList() {
    const container = document.getElementById('nodeSelectionList');
    container.innerHTML = '';
    
    nodesData.nodes.forEach((node, index) => {
        const nodeItem = document.createElement('div');
        nodeItem.className = 'node-selection-item';
        
        nodeItem.innerHTML = `
            <div class="form-check">
                <input class="form-check-input node-checkbox" type="checkbox" 
                       id="node_${index}" data-node-index="${index}">
                <label class="form-check-label" for="node_${index}">
                    <div class="fw-medium">${node.name}</div>
                    <div class="small text-muted">
                        ${node.name_zh ? node.name_zh + ' • ' : ''}${node.location_zh || node.location}
                    </div>
                </label>
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
    resultsContainer.innerHTML = '';
    
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
            <div>
                <strong>${node.name}</strong>
                ${node.name_zh ? `<span class="text-muted ms-1">${node.name_zh}</span>` : ''}
                <div class="small text-muted">${node.location_zh || node.location}</div>
            </div>
            <span class="batch-result-status status-pending">等待中</span>
        </div>
        <div class="batch-result-content">
            <div class="text-muted">正在等待測試開始...</div>
        </div>
    `;
    
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
            <pre class="small bg-light p-2 rounded" style="max-height: 200px; overflow-y: auto;">${data.rawOutput}</pre>
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


 