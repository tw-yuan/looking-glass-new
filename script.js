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
            
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果</h5>
                <div class="bg-light p-3 rounded mb-3">
                    <h6 class="mb-2">探測點資訊</h6>
                    <div class="row">
                        <div class="col-md-6">
                            <p class="mb-1"><strong>網路：</strong> ${probeInfo.network}</p>
                            <p class="mb-1"><strong>ASN：</strong> ${probeInfo.asn}</p>
                        </div>
                        <div class="col-md-6">
                            <p class="mb-1"><strong>DNS：</strong> ${probeInfo.resolvers.join(', ')}</p>
                        </div>
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
                <circle cx="64" cy="64" r="60" fill="${colorMap[color]}" stroke="#ffffff" stroke-width="4"/>
                <g transform="translate(64, 64)">
                    <circle cx="-8" cy="-8" r="28" fill="none" stroke="#ffffff" stroke-width="6"/>
                    <line x1="-8" y1="-28" x2="-8" y2="12" stroke="#ffffff" stroke-width="2" opacity="0.5"/>
                    <line x1="-28" y1="-8" x2="12" y2="-8" stroke="#ffffff" stroke-width="2" opacity="0.5"/>
                    <circle cx="-8" cy="-8" r="3" fill="#ffffff"/>
                    <circle cx="-8" cy="-18" r="2" fill="#ffffff" opacity="0.8"/>
                    <circle cx="2" cy="-8" r="2" fill="#ffffff" opacity="0.8"/>
                    <circle cx="-18" cy="-8" r="2" fill="#ffffff" opacity="0.8"/>
                    <circle cx="-8" cy="2" r="2" fill="#ffffff" opacity="0.8"/>
                    <line x1="12" y1="12" x2="28" y2="28" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
                </g>
            </svg>
        `)}`;
        favicon.href = newFaviconUrl;
    }
}


 