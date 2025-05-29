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
        
        // 初始化節點申請功能
        initNodeApplication();
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
            <div class="fw-semibold fs-5 text-dark mb-2">${node.name}</div>
            <div class="text-muted mb-2">${node.location}</div>
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

    modalTitle.textContent = node.name;
    nodeLocation.textContent = node.location;
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
    
    // 設定主題
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeToggleButton(theme);
    
    // 設定主題切換按鈕事件
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.addEventListener('click', toggleTheme);
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

// === 節點申請功能 ===

// 加密配置 (混淆保護)
const telegramConfig = {
    // 這裡需要您填入實際的 Telegram Bot Token 和 Chat ID
    // 格式：將 Bot Token 分段並進行簡單混淆
    botTokenPart1: btoa('YOUR_BOT_TOKEN_PART1'), // Base64 編碼
    botTokenPart2: btoa('YOUR_BOT_TOKEN_PART2'),
    chatId: btoa('YOUR_CHAT_ID'),
    // 簡單的 XOR 密鑰
    xorKey: 123
};

// 解密 Telegram 配置
function getTelegramConfig() {
    try {
        const token1 = atob(telegramConfig.botTokenPart1);
        const token2 = atob(telegramConfig.botTokenPart2);
        const chatId = atob(telegramConfig.chatId);
        return {
            botToken: token1 + token2,
            chatId: chatId
        };
    } catch (error) {
        console.error('無法解析 Telegram 配置');
        return null;
    }
}

// 初始化節點申請功能
function initNodeApplication() {
    const addNodeBtn = document.getElementById('addNodeBtn');
    const modal = document.getElementById('nodeApplicationModal');
    const form = document.getElementById('nodeApplicationForm');
    
    // 綁定按鈕事件
    addNodeBtn.addEventListener('click', () => {
        generateCaptcha();
        const modalInstance = new bootstrap.Modal(modal);
        modalInstance.show();
    });
    
    // 綁定表單提交事件
    form.addEventListener('submit', handleNodeApplication);
}

// 生成驗證碼
function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 20) + 1;
    const num2 = Math.floor(Math.random() * 20) + 1;
    const captchaText = document.getElementById('captchaText');
    const captchaAnswer = document.getElementById('captchaAnswer');
    
    captchaText.textContent = `請計算：${num1} + ${num2} = `;
    captchaAnswer.value = '';
    captchaAnswer.dataset.correctAnswer = num1 + num2;
}

// 處理節點申請提交
async function handleNodeApplication(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    // 驗證 captcha
    const captchaAnswer = document.getElementById('captchaAnswer');
    const correctAnswer = parseInt(captchaAnswer.dataset.correctAnswer);
    const userAnswer = parseInt(captchaAnswer.value);
    
    if (userAnswer !== correctAnswer) {
        alert('驗證碼錯誤，請重新計算');
        generateCaptcha();
        return;
    }
    
    // 收集表單資料
    const formData = {
        nodeName: document.getElementById('nodeName').value,
        nodeLocation: document.getElementById('nodeLocation').value,
        nodeProvider: document.getElementById('nodeProvider').value,
        providerWebsite: document.getElementById('providerWebsite').value || '未提供',
        nodeTags: document.getElementById('nodeTags').value,
        contactInfo: document.getElementById('contactInfo').value,
        additionalInfo: document.getElementById('additionalInfo').value || '無',
        timestamp: new Date().toLocaleString('zh-TW')
    };
    
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>提交中...';
        
        await sendToTelegram(formData);
        
        // 成功提示
        alert('申請已成功提交！我們會盡快審核您的申請。');
        
        // 關閉模態框並重置表單
        const modal = bootstrap.Modal.getInstance(document.getElementById('nodeApplicationModal'));
        modal.hide();
        form.reset();
        
    } catch (error) {
        console.error('提交失敗:', error);
        alert('提交失敗，請稍後再試。如果問題持續，請直接聯繫我們。');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// 發送到 Telegram
async function sendToTelegram(data) {
    const config = getTelegramConfig();
    if (!config) {
        throw new Error('Telegram 配置錯誤');
    }
    
    const message = `🔥 新節點申請
    
📍 節點名稱：${data.nodeName}
🌍 節點位置：${data.nodeLocation}
👤 服務提供者：${data.nodeProvider}
🌐 提供者網站：${data.providerWebsite}
🏷️ 節點標籤：${data.nodeTags}
📧 聯絡資訊：${data.contactInfo}
📝 額外說明：${data.additionalInfo}
⏰ 提交時間：${data.timestamp}

請審核此申請並更新 nodes.json`;
    
    const telegramUrl = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: config.chatId,
            text: message,
            parse_mode: 'HTML'
        })
    });
    
    if (!response.ok) {
        throw new Error('Telegram API 請求失敗');
    }
}

 