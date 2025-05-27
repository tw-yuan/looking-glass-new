// 節點數據
let nodesData = { nodes: [] }; //

// 初始化頁面
document.addEventListener('DOMContentLoaded', async () => { //
    // Dark Mode Logic
    const darkModeToggle = document.getElementById('darkModeToggle');
    const body = document.body;
    const moonIcon = darkModeToggle.querySelector('.icon-moon');
    const sunIcon = darkModeToggle.querySelector('.icon-sun');

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            body.classList.add('dark-mode');
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'inline-block';
            darkModeToggle.setAttribute('aria-label', '切換至淺色模式');
            darkModeToggle.title = '切換至淺色模式';
        } else {
            body.classList.remove('dark-mode');
            moonIcon.style.display = 'inline-block';
            sunIcon.style.display = 'none';
            darkModeToggle.setAttribute('aria-label', '切換至深色模式');
            darkModeToggle.title = '切換至深色模式';
        }
    };

    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        applyTheme(savedTheme);
    } else if (prefersDark) {
        applyTheme('dark');
    } else {
        applyTheme('light'); // Default to light
    }

    darkModeToggle.addEventListener('click', () => {
        let newTheme;
        if (body.classList.contains('dark-mode')) {
            newTheme = 'light';
        } else {
            newTheme = 'dark';
        }
        applyTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (!localStorage.getItem('theme')) { // Only if no user preference is set
            if (event.matches) {
                applyTheme('dark');
            } else {
                applyTheme('light');
            }
        }
    });

    // Original Page Initialization Logic
    try {
        // 確保 nodes.json 的路徑正確，如果它在 data/ 目錄下，則使用 'data/nodes.json'
        // 如果 nodes.json 與 HTML 檔案在同一目錄，則使用 'nodes.json'
        const response = await fetch('nodes.json'); // 根據您的檔案結構調整此路徑
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        nodesData = await response.json(); //
        renderNodes(); //
        setupModal(); //
        updateCopyrightYear(); //
    } catch (error) {
        console.error('無法載入節點數據:', error); //
        // 可在此處向用戶顯示錯誤訊息
        const container = document.getElementById('nodesContainer');
        if (container) {
            container.innerHTML = '<p class="text-center text-danger">無法載入節點數據，請稍後再試。</p>';
        }
    }
});

// 更新版權年份
function updateCopyrightYear() { //
    const yearElement = document.querySelector('.copyright-year'); //
    if (yearElement) { //
        yearElement.textContent = new Date().getFullYear(); //
    }
}

// 渲染節點卡片
function renderNodes() { //
    const container = document.getElementById('nodesContainer'); //
    container.innerHTML = ''; // 清空現有卡片，以防重複渲染
    nodesData.nodes.forEach(node => { //
        const nodeElement = createNodeCard(node); //
        container.appendChild(nodeElement); //
    });
}

// 創建節點卡片
function createNodeCard(node) { //
    const col = document.createElement('div'); //
    col.className = 'col-md-6 col-lg-4 col-xl-3 mb-4'; // 添加 mb-4 以增加卡片間距
    
    // node-card class 已被正確添加到內部 div，CSS 會作用於此
    col.innerHTML = `
        <div class="bg-white border border-2 rounded-3 p-4 text-center shadow-sm h-100 node-card">
            <div class="fw-semibold fs-5 text-dark mb-2">${node.name}</div>
            <div class="text-muted mb-2">${node.location}</div>
            <div class="text-muted small mb-3">
            <span>Provider: </span>
                <a href="${node['provider-link']}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">
                    ${node.provider}
                </a>
            </div>
        </div>
    `; //

    col.querySelector('.node-card').addEventListener('click', () => { //
        showNodeModal(node); //
    });

    return col; //
}

// 設置模態框
function setupModal() { //
    const modalElement = document.getElementById('nodeModal'); //
    if (!modalElement) return; // 如果模態框不存在則不執行
    const modalInstance = new bootstrap.Modal(modalElement); //
    
    document.addEventListener('keydown', (event) => { //
        if (event.key === 'Escape' && modalElement.classList.contains('show')) { //
            modalInstance.hide(); //
        }
    });

    modalElement.addEventListener('hidden.bs.modal', () => { //
        const resultContainer = modalElement.querySelector('.test-result-container'); // 使用特定 class
        if (resultContainer) { //
            resultContainer.remove(); //
        }
        const targetInput = modalElement.querySelector('#targetHost'); //
        if (targetInput) { //
            targetInput.value = ''; //
        }
        // 重置按鈕狀態
        const testButton = modalElement.querySelector('.btn-primary[aria-label="開始網路測試"]');
        if (testButton) {
            testButton.disabled = false;
            testButton.textContent = '開始測試';
        }
    });
}

// 顯示節點模態框
function showNodeModal(node) { //
    const modalElement = document.getElementById('nodeModal'); //
    if (!modalElement) return;

    const modalTitle = modalElement.querySelector('.modal-title'); //
    const nodeLocation = modalElement.querySelector('.node-location'); //
    const providerLink = modalElement.querySelector('.provider-link'); //
    const testButton = modalElement.querySelector('.btn-primary[aria-label="開始網路測試"]'); //
    const targetInput = modalElement.querySelector('#targetHost'); //
    const testTypeSelect = modalElement.querySelector('#testType'); //

    modalTitle.textContent = node.name; //
    nodeLocation.textContent = node.location; //
    providerLink.textContent = node.provider; //
    providerLink.href = node['provider-link']; //

    const newTestButton = testButton.cloneNode(true); //
    testButton.parentNode.replaceChild(newTestButton, testButton); //

    newTestButton.addEventListener('click', async () => { //
        const target = targetInput.value.trim(); //
        const testType = testTypeSelect.value; //
        
        if (!target) { //
            alert('請輸入目標主機'); //
            return; //
        }

        try {
            newTestButton.disabled = true; //
            newTestButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 測試中...'; //

            // 移除舊的結果（如果有的話）
            const oldResult = modalElement.querySelector('.test-result-container'); //
            if (oldResult) { //
                oldResult.remove(); //
            }
            
            // 創建新的結果容器並立即插入
            const resultContainer = document.createElement('div'); //
            resultContainer.className = 'mt-4 test-result-container'; // 添加特定 class
            modalElement.querySelector('.modal-body').appendChild(resultContainer); //
            
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果</h5>
                <div class="alert alert-info" role="alert">
                    <p class="mb-0">正在請求測量 ID...</p>
                </div>
            `; //

            const measurementResponse = await fetch('https://api.globalping.io/v1/measurements', { //
                method: 'POST', //
                headers: { //
                    'accept': 'application/json', //
                    'content-type': 'application/json' //
                },
                body: JSON.stringify({ //
                    type: testType, //
                    target: target, //
                    inProgressUpdates: true, //
                    limit: 1, // 確保只使用一個探針
                    locations: [{ //
                        magic: node.tags //
                    }]
                })
            });

            if (!measurementResponse.ok) {
                 const errorData = await measurementResponse.json().catch(() => ({}));
                 throw new Error(`測量請求失敗: ${measurementResponse.status} ${measurementResponse.statusText}. ${errorData.error || ''}`);
            }
            const measurementData = await measurementResponse.json(); //
            
            if (!measurementData.id) { //
                throw new Error('無法獲取測量 ID'); //
            }
            
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果</h5>
                <div class="alert alert-info" role="alert">
                    <p class="mb-0">正在等待測試結果... (ID: ${measurementData.id})</p>
                </div>
            `; //

            let result = null; //
            let attempts = 0; //
            const maxAttempts = 60; // 增加等待時間至 60 秒 //
            const delay = 2000; // 輪詢間隔 2 秒

            while (attempts < maxAttempts) { //
                attempts++; //
                await new Promise(resolve => setTimeout(resolve, delay)); //
                
                try {
                    const resultResponse = await fetch(`https://api.globalping.io/v1/measurements/${measurementData.id}`, { //
                        method: 'GET', //
                        headers: { //
                            'accept': 'application/json' //
                        }
                    });
                    if (!resultResponse.ok) {
                        // 如果 API 回應錯誤，但不是最後一次嘗試，則繼續輪詢
                        if (attempts < maxAttempts) {
                             console.warn(`輪詢 API 錯誤: ${resultResponse.status}, 將繼續嘗試`);
                             resultContainer.querySelector('.alert-info p.mb-0').textContent = `測試進行中... (ID: ${measurementData.id}) - 狀態: ${resultResponse.status} (已等待 ${attempts * delay / 1000} 秒)`;
                             continue;
                        }
                        throw new Error(`獲取結果失敗: ${resultResponse.status}`);
                    }
                    const resultData = await resultResponse.json(); //
                    
                    // Globalping API 的結果結構有時會變，需謹慎處理
                    if (resultData && resultData.status === 'finished' && resultData.results && resultData.results.length > 0) { //
                        result = resultData.results[0]; //
                        break; //
                    } else if (resultData && (resultData.status === 'in-progress' || resultData.status === 'creating')) { //
                        resultContainer.querySelector('.alert-info p.mb-0').textContent = `測試進行中... (ID: ${measurementData.id}) - 狀態: ${resultData.status} (已等待 ${attempts * delay / 1000} 秒)`; //
                        continue; //
                    } else if (resultData && resultData.status === 'failed') {
                        throw new Error(`測試失敗於 Globalping: ${resultData.error || '未知錯誤'}`);
                    }
                } catch (error) { //
                    console.error('輪詢失敗:', error); //
                    if (attempts >= maxAttempts) {
                        throw error; // 如果是最後一次嘗試，則拋出錯誤
                    }
                     resultContainer.querySelector('.alert-info p.mb-0').textContent = `輪詢時發生錯誤，將重試... (已等待 ${attempts * delay / 1000} 秒)`;
                }
            }

            if (!result || !result.result || result.result.status !== 'finished') { //
                 const currentStatus = result && result.result ? result.result.status : (measurementData.status || 'unknown');
                throw new Error(`測試超時或未完成 (狀態: ${currentStatus})，請稍後再試。`); //
            }

            const probeInfo = result.probe; //
            const resultInfo = result.result; //
            
            let outputHtml = '';
            if (typeof resultInfo.rawOutput === 'string') {
                outputHtml = `<pre class="mb-0 p-2 border rounded bg-body-tertiary" style="white-space: pre-wrap; word-break: break-all;">${escapeHtml(resultInfo.rawOutput)}</pre>`; //
            } else if (typeof resultInfo.rawOutput === 'object') {
                 outputHtml = `<pre class="mb-0 p-2 border rounded bg-body-tertiary" style="white-space: pre-wrap; word-break: break-all;">${escapeHtml(JSON.stringify(resultInfo.rawOutput, null, 2))}</pre>`;
            } else {
                outputHtml = '<p class="text-muted">無原始輸出可顯示。</p>';
            }
            
            resultContainer.innerHTML = `
                <h5 class="mb-3">測試結果 (ID: ${measurementData.id})</h5>
                <div class="p-3 rounded mb-3 node-info-box">
                    <h6 class="mb-2">探測點資訊</h6>
                    <div class="row">
                        <div class="col-md-6">
                            <p class="mb-1 small"><strong>城市：</strong> ${probeInfo.city}</p>
                            <p class="mb-1 small"><strong>國家：</strong> ${probeInfo.country}</p>
                            <p class="mb-1 small"><strong>網路：</strong> ${probeInfo.network}</p>
                            <p class="mb-1 small"><strong>ASN：</strong> ${probeInfo.asn}</p>
                        </div>
                        <div class="col-md-6">
                            <p class="mb-1 small"><strong>經度：</strong> ${probeInfo.longitude}</p>
                            <p class="mb-1 small"><strong>緯度：</strong> ${probeInfo.latitude}</p>
                            <p class="mb-1 small"><strong>DNS：</strong> ${probeInfo.resolvers ? probeInfo.resolvers.join(', ') : 'N/A'}</p>
                        </div>
                    </div>
                </div>
                <div class="p-3 rounded result-output-box">
                    <h6 class="mb-2">測試輸出</h6>
                    ${outputHtml}
                </div>
            `; //
            // 手動觸發深色模式的樣式更新，如果當前是深色模式
             if (document.body.classList.contains('dark-mode')) {
                resultContainer.querySelectorAll('.node-info-box, .result-output-box, .bg-body-tertiary').forEach(el => {
                    if (el.classList.contains('node-info-box') || el.classList.contains('result-output-box')) {
                         el.style.backgroundColor = '#2c2c2c'; // 使用深色模式的 bg-light 顏色
                         el.style.borderColor = '#444';
                    }
                    if (el.classList.contains('bg-body-tertiary')) { // for pre
                        el.style.backgroundColor = '#3a3a3a';
                        el.style.color = '#e0e0e0';
                        el.style.borderColor = '#555';
                    }
                });
             }


        } catch (error) { //
            console.error('測試失敗:', error); //
            const resultContainer = modalElement.querySelector('.test-result-container');
            if (resultContainer) {
                 resultContainer.innerHTML = `
                    <h5 class="mb-3">測試結果</h5>
                    <div class="alert alert-danger" role="alert">
                        <p class="mb-0">測試失敗: ${error.message}</p>
                    </div>
                `;
            } else {
                alert('測試失敗: ' + error.message); //
            }
        } finally {
            newTestButton.disabled = false; //
            newTestButton.textContent = '開始測試'; //
        }
    });

    const modalInstance = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement); //
    modalInstance.show(); //
}

// Helper function to escape HTML content
function escapeHtml(unsafe) {
    if (unsafe === null || typeof unsafe === 'undefined') return '';
    return unsafe
         .toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}