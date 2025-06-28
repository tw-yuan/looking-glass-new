// 節點數據
let nodesData = { nodes: [] };

// 使用日誌
let usageLogs = JSON.parse(localStorage.getItem('lookingGlassLogs') || '[]');
let userIP = 'unknown';
let sessionId = localStorage.getItem('sessionId') || generateSessionId();

// === API 請求管理和緩存系統 ===

// 節點狀態緩存 - 使用localStorage持久化
let nodeStatusCache = new Map();
let lastStatusCheck = 0;
const STATUS_CACHE_TIME = 2 * 60 * 1000; // 縮短到2分鐘緩存
const CRITICAL_RECHECK_TIME = 30 * 1000; // 30秒內的失敗節點會更頻繁檢查

// API 請求限制管理 - 使用localStorage跨頁面持久化
const API_RESET_INTERVAL = 60 * 1000; // 每分鐘重置計數
const MAX_API_REQUESTS_PER_MINUTE = 60; // 提高到每分鐘60個請求
const API_REQUEST_INTERVAL = 1200; // 請求間隔時間（毫秒）
const CONCURRENT_API_LIMIT = 3; // 同時進行的最大請求數

// 初始化API計數（從localStorage讀取）
function initApiTracking() {
    const saved = localStorage.getItem('apiTracking');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            const now = Date.now();
            
            // 如果超過重置間隔，重置計數
            if (now - data.lastReset > API_RESET_INTERVAL) {
                data.count = 0;
                data.lastReset = now;
            }
            
            return data;
        } catch (e) {
            console.warn('無法解析API追蹤數據');
        }
    }
    
    // 預設值
    return {
        count: 0,
        lastReset: Date.now()
    };
}

// 保存API計數到localStorage
function saveApiTracking(count, lastReset) {
    localStorage.setItem('apiTracking', JSON.stringify({
        count: count,
        lastReset: lastReset
    }));
}

// 初始化
let apiTrackingData = initApiTracking();
let apiRequestCount = apiTrackingData.count;
let lastApiReset = apiTrackingData.lastReset;

// API 請求隊列管理
let apiRequestQueue = [];
let isProcessingQueue = false;
let activeRequests = 0;
let lastRequestTime = 0;

// 智能請求隊列系統
class APIRequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.activeRequests = 0;
        this.lastRequestTime = 0;
        this.priorityTypes = {
            'initialization': 1,  // 初始化時的請求
            'userAction': 2,      // 用戶操作觸發的請求
            'background': 3,      // 背景監控的請求
            'retry': 4            // 重試請求
        };
    }
    
    // 添加請求到隊列
    enqueue(request, priority = 'background') {
        const item = {
            request,
            priority: this.priorityTypes[priority] || 3,
            timestamp: Date.now(),
            retries: 0
        };
        
        // 插入到適當的位置（優先級排序）
        const insertIndex = this.queue.findIndex(item => item.priority > this.priorityTypes[priority]);
        if (insertIndex === -1) {
            this.queue.push(item);
        } else {
            this.queue.splice(insertIndex, 0, item);
        }
        
        // 開始處理隊列
        this.processQueue();
    }
    
    // 處理隊列
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0 && this.activeRequests < CONCURRENT_API_LIMIT) {
            // 檢查是否需要等待
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < API_REQUEST_INTERVAL) {
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_INTERVAL - timeSinceLastRequest));
            }
            
            // 檢查API限制
            if (!checkApiLimit()) {
                console.log('API限制已達，暫停隊列處理');
                this.processing = false;
                // 設置延遲重試
                setTimeout(() => this.processQueue(), 10000);
                return;
            }
            
            const item = this.queue.shift();
            this.activeRequests++;
            this.lastRequestTime = Date.now();
            
            // 執行請求
            this.executeRequest(item).finally(() => {
                this.activeRequests--;
                if (this.queue.length > 0) {
                    setTimeout(() => this.processQueue(), 100);
                }
            });
        }
        
        this.processing = false;
    }
    
    // 執行單個請求
    async executeRequest(item) {
        try {
            const result = await item.request();
            return result;
        } catch (error) {
            console.error('API請求失敗:', error);
            
            // 重試邏輯
            if (item.retries < 3 && !error.message.includes('API請求限制')) {
                item.retries++;
                console.log(`重試請求 (第${item.retries}次)`);
                // 添加回隊列，但降低優先級
                this.enqueue(item.request, 'retry');
            }
            
            throw error;
        }
    }
    
    // 清空隊列
    clear() {
        this.queue = [];
    }
    
    // 獲取隊列狀態
    getStatus() {
        return {
            queueLength: this.queue.length,
            activeRequests: this.activeRequests,
            isProcessing: this.processing
        };
    }
}

// 創建全局API隊列實例
const apiQueue = new APIRequestQueue();

// 背景監控定時器
let backgroundMonitorTimer = null;

// 生成會話ID
function generateSessionId() {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    localStorage.setItem('sessionId', id);
    return id;
}

// === API 請求管理函數 ===

// 檢查API請求限制
function checkApiLimit() {
    const now = Date.now();
    
    // 重置計數器（每分鐘）
    if (now - lastApiReset > API_RESET_INTERVAL) {
        apiRequestCount = 0;
        lastApiReset = now;
        saveApiTracking(apiRequestCount, lastApiReset);
    }
    
    // 如果接近限制，啟用降級模式
    if (apiRequestCount >= MAX_API_REQUESTS_PER_MINUTE * 0.8) {
        enableFallbackMode();
    }
    
    return apiRequestCount < MAX_API_REQUESTS_PER_MINUTE;
}

// 增加API請求計數
function incrementApiCount() {
    apiRequestCount++;
    console.log(`API請求計數: ${apiRequestCount}/${MAX_API_REQUESTS_PER_MINUTE}`);
    
    // 保存到localStorage
    saveApiTracking(apiRequestCount, lastApiReset);
    
    // 更新UI中的API使用狀態指示器（如果存在）
    updateApiUsageIndicator();
}

// 更新API使用狀態指示器
function updateApiUsageIndicator() {
    const indicator = document.getElementById('apiUsageIndicator');
    if (!indicator) return;
    
    const percentage = (apiRequestCount / MAX_API_REQUESTS_PER_MINUTE) * 100;
    const progressBar = indicator.querySelector('.progress-bar');
    
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        
        if (percentage > 80) {
            progressBar.className = 'progress-bar bg-danger';
        } else if (percentage > 60) {
            progressBar.className = 'progress-bar bg-warning';
        } else {
            progressBar.className = 'progress-bar bg-success';
        }
    }
}

// 顯示API使用狀況
function showApiUsageStatus() {
    console.log(`🔄 API使用狀況: ${apiRequestCount}/${MAX_API_REQUESTS_PER_MINUTE} 請求/分鐘`);
    
    if (apiRequestCount > 0) {
        const remainingTime = Math.max(0, API_RESET_INTERVAL - (Date.now() - lastApiReset));
        const remainingMinutes = Math.ceil(remainingTime / 60000);
        
        console.log(`⏱️  剩餘重置時間: ${remainingMinutes} 分鐘`);
        
        if (apiRequestCount >= MAX_API_REQUESTS_PER_MINUTE * 0.7) {
            console.warn(`⚠️  API使用率較高，建議減少頁面重新整理頻率`);
        }
    }
}

// 安全的API請求包裝器
async function safeApiRequest(url, options = {}, priority = 'background') {
    // 創建一個Promise，將請求添加到隊列
    return new Promise((resolve, reject) => {
        const requestFunction = async () => {
            incrementApiCount();
            
            try {
                const response = await fetch(url, options);
                
                // 檢查響應狀態
                if (!response.ok) {
                    if (response.status === 429) {
                        console.warn('API速率限制觸發');
                        showApiLimitWarning();
                        throw new Error('API請求過於頻繁，請稍後再試');
                    } else if (response.status >= 500) {
                        throw new Error('伺服器錯誤，請稍後再試');
                    }
                }
                
                resolve(response);
                return response;
            } catch (error) {
                console.error('API請求失敗:', error);
                
                // 如果是網路錯誤，提供更友好的提示
                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    reject(new Error('網路連接失敗，請檢查網路連線'));
                } else {
                    reject(error);
                }
                
                throw error;
            }
        };
        
        // 將請求添加到隊列
        apiQueue.enqueue(requestFunction, priority);
    });
}

// 顯示API限制警告
function showApiLimitWarning() {
    // 避免重複顯示警告
    if (document.getElementById('apiLimitWarning')) return;
    
    const warning = document.createElement('div');
    warning.id = 'apiLimitWarning';
    warning.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        max-width: 380px;
        background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
        border: 1px solid #ffeaa7;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        animation: slideIn 0.3s ease-out;
    `;
    
    warning.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
            <div style="flex-shrink: 0; width: 24px; height: 24px; background: #f39c12; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <svg width="14" height="14" fill="white" viewBox="0 0 16 16">
                    <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
                </svg>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px; color: #856404; margin-bottom: 4px;">API使用限制</div>
                <div style="font-size: 14px; color: #856404; line-height: 1.4;">請求過於頻繁，請稍後再試。建議減少頁面重新整理的頻率。</div>
            </div>
            <button style="
                background: none;
                border: none;
                padding: 4px;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.2s;
                flex-shrink: 0;
            " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="this.parentElement.parentElement.remove()">
                <svg width="16" height="16" fill="#856404" viewBox="0 0 16 16">
                    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                </svg>
            </button>
        </div>
    `;
    
    // 添加CSS動畫
    if (!document.getElementById('notificationStyles')) {
        const style = document.createElement('style');
        style.id = 'notificationStyles';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(warning);
    
    // 5秒後自動移除
    setTimeout(() => {
        if (warning.parentNode) {
            warning.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => warning.remove(), 300);
        }
    }, 5000);
}

// 檢查節點狀態緩存
function getNodeStatusFromCache(nodeKey) {
    const now = Date.now();
    
    // 從localStorage讀取緩存數據
    const savedCache = localStorage.getItem('nodeStatusCache');
    const savedTime = localStorage.getItem('lastStatusCheck');
    
    if (savedCache && savedTime) {
        try {
            const cacheData = JSON.parse(savedCache);
            const nodeData = cacheData[nodeKey];
            
            if (nodeData) {
                const age = now - nodeData.timestamp;
                
                // 智能緩存策略：
                // 1. 正常在線節點：使用完整緩存時間 (2分鐘)
                // 2. 離線節點：只緩存30秒，更快偵測恢復
                // 3. 新失敗的節點：立即重新檢查
                
                let cacheValidTime = STATUS_CACHE_TIME;
                
                if (nodeData.status === 'offline' || nodeData.status === 'error') {
                    cacheValidTime = CRITICAL_RECHECK_TIME; // 30秒
                    console.log(`🔍 離線節點 ${nodeKey} 使用短緩存時間: ${cacheValidTime/1000}秒`);
                }
                
                if (age < cacheValidTime) {
                    return nodeData;
                } else {
                    console.log(`⏰ 節點 ${nodeKey} 緩存已過期 (${Math.round(age/1000)}秒), 需要重新檢查`);
                }
            }
        } catch (e) {
            console.warn('無法解析節點狀態緩存');
            localStorage.removeItem('nodeStatusCache');
            localStorage.removeItem('lastStatusCheck');
        }
    }
    
    return null;
}

// 降級模式：當API限制達到時的備用方案
function enableFallbackMode() {
    console.log('啟用降級模式：減少API調用');
    
    // 避免重複顯示
    if (document.getElementById('fallbackModeNotice')) return;
    
    // 顯示降級模式提示
    const fallbackNotice = document.createElement('div');
    fallbackNotice.id = 'fallbackModeNotice';
    fallbackNotice.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9998;
        max-width: 380px;
        background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%);
        border: 1px solid #bee5eb;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        animation: slideIn 0.3s ease-out;
    `;
    
    fallbackNotice.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
            <div style="flex-shrink: 0; width: 24px; height: 24px; background: #17a2b8; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <svg width="14" height="14" fill="white" viewBox="0 0 16 16">
                    <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
                </svg>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px; color: #0c5460; margin-bottom: 4px;">節能模式已啟用</div>
                <div style="font-size: 14px; color: #0c5460; line-height: 1.4;">為避免API限制，已啟用節能模式。部分功能可能響應較慢。</div>
                <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px;">
                    <div style="font-size: 12px; color: #0c5460;">緩存時間已延長至10分鐘</div>
                    <svg width="16" height="16" fill="#17a2b8" viewBox="0 0 16 16">
                        <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
                        <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
                    </svg>
                </div>
            </div>
            <button style="
                background: none;
                border: none;
                padding: 4px;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.2s;
                flex-shrink: 0;
            " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="this.parentElement.parentElement.remove()">
                <svg width="16" height="16" fill="#0c5460" viewBox="0 0 16 16">
                    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                </svg>
            </button>
        </div>
    `;
    
    document.body.appendChild(fallbackNotice);
    
    // 延長緩存時間
    STATUS_CACHE_TIME = 10 * 60 * 1000; // 延長到10分鐘
    
    // 8秒後自動移除
    setTimeout(() => {
        if (fallbackNotice.parentNode) {
            fallbackNotice.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => fallbackNotice.remove(), 300);
        }
    }, 8000);
}

// 設置節點狀態緩存
function setNodeStatusCache(nodeKey, status) {
    const now = Date.now();
    
    // 更新記憶體緩存
    nodeStatusCache.set(nodeKey, {
        status: status,
        timestamp: now
    });
    
    // 更新localStorage緩存
    const savedCache = localStorage.getItem('nodeStatusCache');
    let cacheData = {};
    
    if (savedCache) {
        try {
            cacheData = JSON.parse(savedCache);
        } catch (e) {
            console.warn('無法解析現有緩存數據');
        }
    }
    
    cacheData[nodeKey] = {
        status: status,
        timestamp: now
    };
    
    localStorage.setItem('nodeStatusCache', JSON.stringify(cacheData));
    localStorage.setItem('lastStatusCheck', now.toString());
    
    // 如果狀態改變了，記錄日誌
    const oldData = cacheData[nodeKey];
    if (oldData && oldData.status !== status) {
        console.log(`🔄 節點狀態變更: ${nodeKey} ${oldData.status} → ${status}`);
    }
}

// 強制刷新節點狀態（清除緩存）
function forceRefreshNodeStatus(nodeKey = null) {
    if (nodeKey) {
        // 刷新特定節點
        const savedCache = localStorage.getItem('nodeStatusCache');
        if (savedCache) {
            try {
                const cacheData = JSON.parse(savedCache);
                delete cacheData[nodeKey];
                localStorage.setItem('nodeStatusCache', JSON.stringify(cacheData));
                console.log(`🔄 已清除節點 ${nodeKey} 的緩存`);
            } catch (e) {
                console.warn('無法更新緩存');
            }
        }
    } else {
        // 刷新所有節點
        localStorage.removeItem('nodeStatusCache');
        localStorage.removeItem('lastStatusCheck');
        nodeStatusCache.clear();
        console.log('🔄 已清除所有節點狀態緩存');
    }
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

// 分析 Target 使用情況 - 進階版本
async function analyzeTargetUsage(logs) {
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
                    resolvedInfo: null // 將存放 DNS 解析和 ASN 資訊
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
    
    const result = Object.values(targetStats)
        .map(target => ({
            ...target,
            uniqueUsers: target.uniqueUsers.size,
            mainTestType: Object.keys(target.testTypes).reduce((a, b) => 
                target.testTypes[a] > target.testTypes[b] ? a : b, 'ping')
        }))
        .sort((a, b) => b.count - a.count);
    
    // 同步等待所有 DNS 和 ASN 查詢完成
    await Promise.all(result.map(target => resolveTargetInfo(target)));
    
    return result;
}

// 移除了 analyzeTestTypes 函數，因為測試類型統計不實用

// 簡化目標類型偵測（保留給最近測試使用）
function detectTargetType(target) {
    if (!target || target === 'null') return '未知';
    if (isIPAddress(target)) return 'IP';
    return '域名';
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

// DNS 解析和 ASN 查詢
const targetResolutionCache = new Map();

async function resolveTargetInfo(target) {
    const targetName = target.name.toLowerCase();
    
    // 如果已經是 IP 位址，直接查詢 ASN
    if (isIPAddress(targetName)) {
        if (!targetResolutionCache.has(targetName)) {
            try {
                const asnInfo = await getASNInfo(targetName);
                target.resolvedInfo = {
                    ips: { v4: targetName.includes('.') ? [targetName] : [], v6: targetName.includes(':') ? [targetName] : [] },
                    asn: asnInfo
                };
                targetResolutionCache.set(targetName, target.resolvedInfo);
                console.log(`解析完成 IP: ${targetName}`, target.resolvedInfo);
            } catch (error) {
                console.log(`無法查詢 ${targetName} 的 ASN 資訊`);
                target.resolvedInfo = { ips: { v4: [], v6: [] }, asn: null };
            }
        } else {
            target.resolvedInfo = targetResolutionCache.get(targetName);
        }
        return;
    }
    
    // 如果是域名，進行 DNS 解析
    if (!targetResolutionCache.has(targetName)) {
        try {
            console.log(`開始解析域名: ${targetName}`);
            const dnsInfo = await resolveDNS(targetName);
            target.resolvedInfo = dnsInfo;
            targetResolutionCache.set(targetName, dnsInfo);
            console.log(`解析完成域名: ${targetName}`, dnsInfo);
        } catch (error) {
            console.log(`無法解析 ${targetName}`, error);
            target.resolvedInfo = { ips: { v4: [], v6: [] }, asn: null };
        }
    } else {
        target.resolvedInfo = targetResolutionCache.get(targetName);
    }
}

// 檢查是否為 IP 位址
function isIPAddress(target) {
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    return ipv4Regex.test(target) || ipv6Regex.test(target) || target.includes('::');
}

// DNS 解析函數
async function resolveDNS(hostname) {
    try {
        console.log(`開始 DNS 解析: ${hostname}`);
        
        // 使用 Cloudflare DNS over HTTPS 進行解析
        const promises = [
            fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
                headers: { 'Accept': 'application/dns-json' }
            }),
            fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=AAAA`, {
                headers: { 'Accept': 'application/dns-json' }
            })
        ];
        
        const [ipv4Response, ipv6Response] = await Promise.allSettled(promises);
        
        let ipv4Data = { Answer: [] };
        let ipv6Data = { Answer: [] };
        
        if (ipv4Response.status === 'fulfilled' && ipv4Response.value.ok) {
            ipv4Data = await ipv4Response.value.json();
        }
        
        if (ipv6Response.status === 'fulfilled' && ipv6Response.value.ok) {
            ipv6Data = await ipv6Response.value.json();
        }
        
        const result = {
            ips: {
                v4: ipv4Data.Answer ? ipv4Data.Answer.filter(a => a.type === 1).map(a => a.data) : [],
                v6: ipv6Data.Answer ? ipv6Data.Answer.filter(a => a.type === 28).map(a => a.data) : []
            },
            asn: null
        };
        
        console.log(`DNS 解析結果 ${hostname}:`, result.ips);
        
        // 查詢第一個 IP 的 ASN
        const firstIP = result.ips.v4[0] || result.ips.v6[0];
        if (firstIP) {
            console.log(`開始查詢 ASN: ${firstIP}`);
            result.asn = await getASNInfo(firstIP);
        }
        
        return result;
    } catch (error) {
        console.log(`DNS 解析失敗: ${error.message}`);
        return {
            ips: { v4: [], v6: [] },
            asn: null
        };
    }
}

// 查詢 ASN 資訊 - 使用多個 API 提高成功率
async function getASNInfo(ip) {
    // 嘗試 ipinfo.io
    try {
        console.log(`嘗試 ipinfo.io 查詢 ASN: ${ip}`);
        const response = await fetch(`https://ipinfo.io/${ip}/json`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`IPInfo API 回應 ${ip}:`, data);
            
            if (data.org) {
                // ipinfo.io 的 org 格式通常是 "AS12345 Company Name"
                const asnMatch = data.org.match(/^AS(\d+)\s+(.+)$/);
                if (asnMatch) {
                    return {
                        number: asnMatch[1],
                        name: asnMatch[2],
                        source: 'ipinfo.io'
                    };
                }
                // 如果沒有 AS 前綴，直接使用 org 資訊
                return {
                    number: 'N/A',
                    name: data.org,
                    source: 'ipinfo.io'
                };
            }
        }
    } catch (error) {
        console.log(`ipinfo.io API 失敗: ${error.message}`);
    }
    
    // 如果 ipinfo.io 失敗，嘗試 ip-api.com
    try {
        console.log(`嘗試 ip-api.com 查詢 ASN: ${ip}`);
        const response = await fetch(`https://ip-api.com/json/${ip}?fields=status,as,org`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`IP-API 回應 ${ip}:`, data);
            
            if (data.status === 'success' && data.as) {
                const asnMatch = data.as.match(/^AS(\d+)\s+(.+)$/);
                if (asnMatch) {
                    return {
                        number: asnMatch[1],
                        name: asnMatch[2],
                        source: 'ip-api.com'
                    };
                }
            }
        }
    } catch (error) {
        console.log(`ip-api.com API 失敗: ${error.message}`);
    }
    
    console.log(`所有 ASN API 都失敗: ${ip}`);
    return null;
}

// 格式化目標 IP 位址顯示
function formatTargetIPs(resolvedInfo) {
    if (!resolvedInfo || !resolvedInfo.ips) {
        return '<span class="text-muted">解析中...</span>';
    }
    
    const ips = [];
    if (resolvedInfo.ips.v4 && resolvedInfo.ips.v4.length > 0) {
        const fullIP = resolvedInfo.ips.v4[0];
        ips.push(`<span class="text-info" title="${fullIP}">${fullIP}</span>`);
    }
    if (resolvedInfo.ips.v6 && resolvedInfo.ips.v6.length > 0) {
        const fullIPv6 = resolvedInfo.ips.v6[0];
        const ipv6Display = fullIPv6.length > 16 ? 
            fullIPv6.substring(0, 16) + '...' : 
            fullIPv6;
        ips.push(`<span class="text-success" title="${fullIPv6}">${ipv6Display}</span>`);
    }
    
    if (ips.length === 0) {
        return '<span class="text-muted">無法解析</span>';
    }
    
    return ips.join('<br>');
}

// 格式化 ASN 資訊顯示
function formatASNInfo(resolvedInfo) {
    if (!resolvedInfo || !resolvedInfo.asn) {
        return '<span class="text-muted">查詢中...</span>';
    }
    
    const asn = resolvedInfo.asn;
    const fullName = asn.name || 'Unknown';
    const displayName = fullName.length > 12 ? fullName.substring(0, 12) + '...' : fullName;
    const asnNumber = asn.number;
    const bgpToolsUrl = `https://bgp.tools/as/${asnNumber}`;
    
    return `<div class="fw-bold"><a href="${bgpToolsUrl}" target="_blank" rel="noopener noreferrer" class="text-warning text-decoration-none" title="AS${asnNumber} ${fullName}">AS${asnNumber}</a></div><small class="text-muted" title="${fullName}">${displayName}</small>`;
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
    await updateLogsModalContent(stats, nodeUsageArray, recentLogs);
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
async function updateLogsModalContent(stats, nodeUsageArray, recentLogs) {
    const modalBody = document.getElementById('logsModalBody');
    if (!modalBody) return;
    
    // 使用 DocumentFragment 提升性能
    const fragment = document.createDocumentFragment();
    const container = document.createElement('div');
    
    // 限制顯示數量以提升性能
    const maxTargetDisplay = 15;
    const maxLogDisplay = 25;
    
    // 分析 Target 使用情況
    const targetAnalysis = await analyzeTargetUsage(recentLogs);
    
    container.innerHTML = `
        <!-- 統計概覽 -->
        <div class="row mb-2 g-1">
            <div class="col-6">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-primary mb-0">${stats.totalTests}</h5>
                    <small class="text-muted">次測試</small>
                </div>
            </div>
            <div class="col-6">
                <div class="text-center p-2 bg-light rounded">
                    <h5 class="text-success mb-0">${targetAnalysis.length}</h5>
                    <small class="text-muted">種目標</small>
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
                                <th class="py-1 text-center small">目標與類型</th>
                                <th class="py-1 text-center small">IP 位址</th>
                                <th class="py-1 text-center small">ASN</th>
                                <th class="py-1 text-center small">測試次數</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${targetAnalysis.slice(0, maxTargetDisplay).map(target => `
                                <tr>
                                    <td class="py-1 text-center">
                                        <div class="fw-bold small text-primary">${target.name}</div>
                                        <small class="text-muted">${target.mainTestType.toUpperCase()}</small>
                                    </td>
                                    <td class="py-1 text-center">
                                        <div class="small">${formatTargetIPs(target.resolvedInfo)}</div>
                                    </td>
                                    <td class="py-1 text-center">
                                        <div class="small">${formatASNInfo(target.resolvedInfo)}</div>
                                    </td>
                                    <td class="py-1 text-center">
                                        <span class="badge bg-primary" style="font-size: 0.7rem;">${target.count}</span>
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
                <small class="mb-0 fw-bold">節點使用率</small>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th class="py-1 text-center small">節點</th>
                                <th class="py-1 text-center small">提供者</th>
                                <th class="py-1 text-center small">測試數</th>
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
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <!-- 最近測試 -->
        <div class="card" style="margin-top: 1rem;">
            <div class="card-header py-1 d-flex justify-content-between align-items-center">
                <small class="mb-0 fw-bold">最近測試</small>
                <div>
                    <button class="btn btn-xs btn-outline-success" onclick="exportServerLogs(event)" title="匯出日誌" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">匯出日誌</button>
                </div>
            </div>
            <div class="card-body p-0">
                <div style="max-height: 180px; overflow-y: auto;">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">時間</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">類型</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">目標</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">節點</th>
                                <th class="py-0 text-center" style="font-size: 0.7rem;">使用者IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentLogs.filter(log => log.action === 'test_started' && log.target && log.target !== 'null').slice(0, maxLogDisplay).map(log => `
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
                                        <span class="badge bg-primary" style="font-size: 0.6rem;">${(log.testType || 'ping').toUpperCase()}</span>
                                    </td>
                                    <td class="py-0 text-center fw-bold" style="font-size: 0.65rem;">
                                        <div class="text-primary">${log.target || '未知'}</div>
                                        <small class="text-muted">${detectTargetType(log.target)}</small>
                                    </td>
                                    <td class="py-0 text-center" style="font-size: 0.65rem;">
                                        <div class="fw-bold">${log.nodeName}</div>
                                        <small class="text-muted">${log.nodeLocation}</small>
                                    </td>
                                    <td class="py-0 text-center text-muted" style="font-size: 0.65rem;">
                                        ${formatIPDisplay(log.ip)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${recentLogs.filter(log => log.action === 'test_started' && log.target && log.target !== 'null').length === 0 ? 
                        '<div class="text-center text-muted p-3"><small>尚無有效測試記錄</small></div>' : ''}
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
        // 顯示目前API使用狀況
        showApiUsageStatus();
        
        // 初始化主題
        initTheme();
        
        const response = await fetch('nodes.json');
        nodesData = await response.json();
        renderNodes();
        setupModal();
        updateCopyrightYear();
        
        // 初始化統計面板
        initStatsPanel();
        
        // 統一節點狀態檢查
        // 不再分別調用桌面版和手機版的檢查，避免重複API請求
        checkAllNodesStatus();
        
        // 初始化手機版UI（但不再重複檢查節點）
        console.log('節點數據載入完成，準備初始化手機版');
        console.log('節點數量:', nodesData.nodes.length);
        console.log('螢幕寬度:', window.innerWidth);
        
        // 初始化手機版UI，但不重複檢查節點狀態
        initMobileVersionUI();
        
        // 獲取用戶IP
        await getUserIP();
        
        // 啟動背景監控
        startBackgroundMonitoring();
        
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
            const measurementResponse = await safeApiRequest('https://api.globalping.io/v1/measurements', {
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
                    const resultResponse = await safeApiRequest(`https://api.globalping.io/v1/measurements/${measurementData.id}`, {
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
        const response = await safeApiRequest('https://api.globalping.io/v1/probes');
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
        
        // 計算統計數據 - 現在使用實際測試檢查節點狀態
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
    
    // 為每個節點檢查是否在線 - 優先使用緩存，減少API請求
    const statusChecks = nodesData.nodes.map(async (node) => {
        stats.total++;
        
        let isOnline = false;
        let matchingProbes = [];
        
        // 檢查緩存
        const cacheKey = node.tags;
        const cachedResult = nodeStatusCache.get(cacheKey);
        
        if (isCacheValid(cachedResult)) {
            // 使用緩存結果
            isOnline = cachedResult.status === 'online';
            console.log(`使用緩存結果: ${node.name} = ${cachedResult.status}`);
        } else {
            // 檢查API限制
            if (!checkApiLimit()) {
                console.warn(`API限制已達上限，${node.name} 默認為離線`);
                isOnline = false;
            } else {
                try {
                    // 使用安全的API請求檢查節點狀態
                    const testResponse = await safeApiRequest('https://api.globalping.io/v1/measurements', {
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
                    isOnline = !!data.id;
                    
                    // 更新緩存
                    nodeStatusCache.set(cacheKey, {
                        status: isOnline ? 'online' : 'offline',
                        timestamp: Date.now()
                    });
                    
                } catch (error) {
                    console.warn(`節點 ${node.name} 狀態檢查失敗:`, error.message);
                    isOnline = false;
                    
                    // 緩存錯誤狀態
                    nodeStatusCache.set(cacheKey, {
                        status: 'offline',
                        timestamp: Date.now()
                    });
                }
            }
        }
        
        // 同時查找匹配的 probes 來獲取詳細信息
        if (probes) {
            matchingProbes = probes.filter(probe => {
                if (!probe.tags || !Array.isArray(probe.tags)) return false;
                
                return probe.tags.some(tag => {
                    if (typeof node.tags === 'string') {
                        return node.tags.includes(tag);
                    } else if (Array.isArray(node.tags)) {
                        return node.tags.includes(tag);
                    }
                    return false;
                });
            });
        }
        
        return { node, isOnline, matchingProbes };
    });
    
    // 等待所有狀態檢查完成
    const results = await Promise.allSettled(statusChecks);
    
    // 處理檢查結果
    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { node, isOnline, matchingProbes } = result.value;
            
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
                    continent: node.continent,
                    probeData: primaryProbe
                });
            } else {
                // 沒有找到匹配的 probe，使用節點自身資訊
                const networkType = getNodeNetworkType(node, null);
                stats.byNetwork[networkType] = (stats.byNetwork[networkType] || 0) + 1;
                
                stats.nodeDetails.push({
                    name: node.name,
                    name_zh: node.name_zh,
                    location: node.location,
                    location_zh: node.location_zh,
                    provider: node.provider,
                    providerLink: node['provider-link'],
                    status: isOnline ? 'online' : 'offline',
                    version: node.version || 'N/A',
                    network: 'N/A',
                    asn: node.asn || 'N/A',
                    networkType: networkType,
                    protocols: ['未知'],
                    continent: node.continent,
                    probeData: null
                });
            }
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
                <div class="d-flex align-items-center mb-2">
                    <div class="flex-fill" style="min-width: 0;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="text-truncate" style="max-width: 80px;">${regionName}</span>
                            <div class="d-flex align-items-center ms-2">
                                <div class="progress me-2" style="width: 100px; height: 8px;">
                                    <div class="progress-bar" style="width: ${percentage}%"></div>
                                </div>
                                <span class="text-muted" style="min-width: 60px; text-align: right;">${count} (${percentage}%)</span>
                            </div>
                        </div>
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
                <div class="d-flex align-items-center mb-2">
                    <div class="flex-fill" style="min-width: 0;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="text-truncate" style="max-width: 80px;">${network}</span>
                            <div class="d-flex align-items-center ms-2">
                                <div class="progress me-2" style="width: 100px; height: 8px;">
                                    <div class="progress-bar" style="width: ${percentage}%"></div>
                                </div>
                                <span class="text-muted" style="min-width: 60px; text-align: right;">${count} (${percentage}%)</span>
                            </div>
                        </div>
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
                ? '<span class="badge bg-success me-2">上線</span>'
                : '<span class="badge bg-danger me-2">下線</span>';
            
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
            const response = await safeApiRequest('https://api.globalping.io/v1/measurements', {
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
// 使用全局的緩存系統
const CACHE_DURATION = 5 * 60 * 1000; // 5分鐘緩存
const API_DELAY = 200; // API請求間隔（毫秒）

// 檢查緩存是否有效
function isCacheValid(cacheEntry) {
    if (!cacheEntry) return false;
    return Date.now() - cacheEntry.timestamp < CACHE_DURATION;
}

// 更新狀態指示器
function updateStatusIndicator(index, status) {
    const statusIndicator = document.getElementById(`main_status_${index}`);
    if (!statusIndicator) return;
    
    switch (status) {
        case 'online':
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-success" title="線上"></i>';
            break;
        case 'offline':
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-danger" title="離線"></i>';
            break;
        case 'unknown':
        default:
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-warning" title="狀態未知"></i>';
            break;
    }
}

// 檢查單個節點狀態
async function checkSingleNodeStatus(node, index) {
    const cacheKey = node.tags;
    const cachedResult = nodeStatusCache.get(cacheKey);
    
    // 如果緩存有效，直接使用緩存結果
    if (isCacheValid(cachedResult)) {
        updateStatusIndicator(index, cachedResult.status);
        return cachedResult.status;
    }
    
    try {
        // 使用安全的API請求包裝器
        const testResponse = await safeApiRequest('https://api.globalping.io/v1/measurements', {
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
        const status = data.id ? 'online' : 'offline';
        
        // 更新緩存
        nodeStatusCache.set(cacheKey, {
            status: status,
            timestamp: Date.now()
        });
        
        // 更新UI
        updateStatusIndicator(index, status);
        
        return status;
    } catch (error) {
        // 檢查失敗，緩存未知狀態
        nodeStatusCache.set(cacheKey, {
            status: 'unknown',
            timestamp: Date.now()
        });
        
        updateStatusIndicator(index, 'unknown');
        console.warn(`節點 ${node.name} 狀態檢查失敗:`, error);
        return 'unknown';
    }
}

// 統一的節點狀態檢查函數
// 同時更新桌面版和手機版的狀態顯示
async function checkAllNodesStatus() {
    if (!nodesData || !nodesData.nodes || nodesData.nodes.length === 0) {
        console.warn('沒有可用的節點數據');
        return;
    }
    
    console.log('開始統一檢查所有節點狀態...');
    
    // 使用優先級隊列處理所有節點
    const promises = [];
    
    for (let i = 0; i < nodesData.nodes.length; i++) {
        const node = nodesData.nodes[i];
        const index = i;
        
        // 創建一個Promise來處理每個節點
        const checkPromise = new Promise(async (resolve, reject) => {
            const cacheKey = node.tags;
            const cachedResult = nodeStatusCache.get(cacheKey);
            
            // 如果緩存有效，使用緩存結果
            if (isCacheValid(cachedResult)) {
                const status = cachedResult.status;
                
                // 更新桌面版UI
                updateStatusIndicator(index, status);
                
                // 更新手機版UI
                const mobileStatusIndicator = document.getElementById(`mobile_status_${index}`);
                if (mobileStatusIndicator) {
                    const statusClass = status === 'online' ? 'status-indicator online' : 'status-indicator offline';
                    mobileStatusIndicator.className = statusClass;
                }
                
                resolve(status);
                return;
            }
            
            try {
                const testResponse = await safeApiRequest('https://api.globalping.io/v1/measurements', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'ping',
                        target: '8.8.8.8',
                        limit: 1,
                        locations: [{ magic: node.tags }]
                    })
                }, 'initialization'); // 使用初始化優先級
                
                const data = await testResponse.json();
                const status = data.id ? 'online' : 'offline';
                
                // 更新緩存
                nodeStatusCache.set(cacheKey, {
                    status: status,
                    timestamp: Date.now()
                });
                
                // 更新桌面版UI
                updateStatusIndicator(index, status);
                
                // 更新手機版UI
                const mobileStatusIndicator = document.getElementById(`mobile_status_${index}`);
                if (mobileStatusIndicator) {
                    const statusClass = status === 'online' ? 'status-indicator online' : 'status-indicator offline';
                    mobileStatusIndicator.className = statusClass;
                }
                
                resolve(status);
            } catch (error) {
                console.warn(`節點 ${node.name} 狀態檢查失敗:`, error.message);
                
                // 緩存錯誤狀態
                nodeStatusCache.set(cacheKey, {
                    status: 'offline',
                    timestamp: Date.now()
                });
                
                // 更新兩個版本的UI
                updateStatusIndicator(index, 'offline');
                const mobileStatusIndicator = document.getElementById(`mobile_status_${index}`);
                if (mobileStatusIndicator) {
                    mobileStatusIndicator.className = 'status-indicator offline';
                }
                
                resolve('offline');
            }
        });
        
        promises.push(checkPromise);
    }
    
    // 等待所有檢查完成
    const results = await Promise.allSettled(promises);
    
    // 統計結果
    const online = results.filter(r => r.status === 'fulfilled' && r.value === 'online').length;
    const offline = results.filter(r => r.status === 'fulfilled' && r.value === 'offline').length;
    
    console.log(`節點狀態檢查完成: ${online} 線上, ${offline} 離線`);
}

// 優化的主畫面節點狀態檢查函數
async function checkMainNodeStatus() {
    if (!nodesData || !nodesData.nodes || nodesData.nodes.length === 0) {
        console.warn('沒有可用的節點數據');
        return;
    }
    
    const statusChecks = [];
    
    // 分批處理節點，避免同時發送太多請求
    for (let i = 0; i < nodesData.nodes.length; i++) {
        const node = nodesData.nodes[i];
        
        // 添加延遲避免API速率限制
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, API_DELAY));
        }
        
        statusChecks.push(checkSingleNodeStatus(node, i));
    }
    
    // 等待所有狀態檢查完成
    const results = await Promise.allSettled(statusChecks);
    
    // 統計結果
    const online = results.filter(r => r.status === 'fulfilled' && r.value === 'online').length;
    const offline = results.filter(r => r.status === 'fulfilled' && r.value === 'offline').length;
    const unknown = results.filter(r => r.status === 'fulfilled' && r.value === 'unknown').length;
    
    console.log(`節點狀態檢查完成: ${online} 線上, ${offline} 離線, ${unknown} 未知`);
}

// 清理過期緩存
function cleanupCache() {
    const now = Date.now();
    for (const [key, value] of nodeStatusCache.entries()) {
        if (now - value.timestamp >= CACHE_DURATION) {
            nodeStatusCache.delete(key);
        }
    }
}

// 定期清理緩存
setInterval(cleanupCache, CACHE_DURATION);

// === 手機版專用功能 ===

// 手機版變數
let mobileSelectedNode = null;
let mobileCurrentTest = null;

// 手機版初始化
function initMobileVersion() {
    console.log('正在初始化手機版...');
    renderMobileNodes();
    setupMobileEventListeners();
}

// 手機版UI初始化（不包含節點狀態檢查）
function initMobileVersionUI() {
    console.log('正在初始化手機版UI...');
    renderMobileNodesUI();
    setupMobileEventListeners();
}

// 渲染手機版節點列表
function renderMobileNodes() {
    console.log('開始渲染手機版節點列表...');
    const container = document.getElementById('mobileNodesList');
    
    if (!container) {
        console.error('找不到手機版節點容器 #mobileNodesList');
        return;
    }
    
    console.log('找到節點容器，準備渲染', nodesData.nodes.length, '個節點');
    container.innerHTML = '';
    
    nodesData.nodes.forEach((node, index) => {
        const nodeItem = document.createElement('div');
        nodeItem.className = 'mobile-node-item';
        nodeItem.dataset.nodeIndex = index;
        
        nodeItem.innerHTML = `
            <div class="node-info">
                <div class="node-name">${node.name_zh || node.name}</div>
                <div class="node-location">${node.location_zh || node.location}</div>
                <div class="node-provider">${node.provider}</div>
            </div>
            <div class="node-status">
                <div class="status-indicator offline" id="mobile_status_${index}"></div>
            </div>
        `;
        
        // 添加點擊事件
        nodeItem.addEventListener('click', () => selectMobileNode(node, index));
        
        container.appendChild(nodeItem);
    });
    
    // 檢查節點狀態
    checkMobileNodeStatus();
}

// 渲染手機版節點列表UI（不包含狀態檢查）
function renderMobileNodesUI() {
    console.log('開始渲染手機版節點UI...');
    const container = document.getElementById('mobileNodesList');
    
    if (!container) {
        console.error('找不到手機版節點容器 #mobileNodesList');
        return;
    }
    
    console.log('找到節點容器，準備渲染', nodesData.nodes.length, '個節點');
    container.innerHTML = '';
    
    nodesData.nodes.forEach((node, index) => {
        const nodeItem = document.createElement('div');
        nodeItem.className = 'mobile-node-item';
        nodeItem.dataset.nodeIndex = index;
        
        nodeItem.innerHTML = `
            <div class="node-info">
                <div class="node-name">${node.name_zh || node.name}</div>
                <div class="node-location">${node.location_zh || node.location}</div>
                <div class="node-provider">${node.provider}</div>
            </div>
            <div class="node-status">
                <div class="status-indicator offline" id="mobile_status_${index}"></div>
            </div>
        `;
        
        // 添加點擊事件
        nodeItem.addEventListener('click', () => selectMobileNode(node, index));
        
        container.appendChild(nodeItem);
    });
    
    // 不再在這裡檢查節點狀態，狀態檢查由checkAllNodesStatus統一處理
    console.log('手機版UI渲染完成，狀態將由統一函數更新');
}

// 檢查手機版節點狀態
async function checkMobileNodeStatus() {
    console.log('開始檢查手機版節點狀態...');
    
    // 順序檢查節點，避免同時發送大量請求
    for (let index = 0; index < nodesData.nodes.length; index++) {
        const node = nodesData.nodes[index];
        const statusIndicator = document.getElementById(`mobile_status_${index}`);
        
        if (!statusIndicator) continue;
        
        const cacheKey = node.tags;
        const cachedResult = nodeStatusCache.get(cacheKey);
        
        // 如果緩存有效，使用緩存結果
        if (isCacheValid(cachedResult)) {
            const statusClass = cachedResult.status === 'online' ? 'status-indicator online' : 'status-indicator offline';
            statusIndicator.className = statusClass;
            continue;
        }
        
        // 檢查API限制
        if (!checkApiLimit()) {
            console.warn(`API限制已達上限，跳過節點 ${node.name}`);
            statusIndicator.className = 'status-indicator offline';
            continue;
        }
        
        try {
            const testResponse = await safeApiRequest('https://api.globalping.io/v1/measurements', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'ping',
                    target: '8.8.8.8',
                    limit: 1,
                    locations: [{ magic: node.tags }]
                })
            });
            
            const data = await testResponse.json();
            const status = data.id ? 'online' : 'offline';
            
            // 更新緩存
            nodeStatusCache.set(cacheKey, {
                status: status,
                timestamp: Date.now()
            });
            
            // 更新UI
            const statusClass = status === 'online' ? 'status-indicator online' : 'status-indicator offline';
            statusIndicator.className = statusClass;
            
        } catch (error) {
            console.warn(`檢查節點 ${node.name} 狀態失敗:`, error.message);
            
            // 緩存錯誤狀態
            nodeStatusCache.set(cacheKey, {
                status: 'offline',
                timestamp: Date.now()
            });
            
            statusIndicator.className = 'status-indicator offline';
        }
        
        // 在請求之間添加延遲
        if (index < nodesData.nodes.length - 1) {
            await new Promise(resolve => setTimeout(resolve, API_DELAY));
        }
    }
    
    console.log('手機版節點狀態檢查完成');
}

// 選擇手機版節點
function selectMobileNode(node, index) {
    // 清除之前的選擇
    document.querySelectorAll('.mobile-node-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // 選中當前節點
    const selectedItem = document.querySelector(`[data-node-index="${index}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
    
    mobileSelectedNode = { ...node, index };
    
    // 更新測試按鈕
    const testButton = document.getElementById('mobileStartTest');
    testButton.disabled = false;
    testButton.textContent = '開始測試';
}

// 設置手機版事件監聽器
function setupMobileEventListeners() {
    // 主題切換按鈕
    const mobileThemeToggle = document.getElementById('mobileThemeToggle');
    if (mobileThemeToggle) {
        mobileThemeToggle.addEventListener('click', () => {
            toggleTheme();
            updateMobileThemeIcon();
        });
    }
    
    // 統計按鈕
    const mobileStatsBtn = document.getElementById('mobileStatsBtn');
    if (mobileStatsBtn) {
        mobileStatsBtn.addEventListener('click', showMobileStatsModal);
    }
    
    // 日誌按鈕
    const mobileLogsBtn = document.getElementById('mobileLogsBtn');
    if (mobileLogsBtn) {
        mobileLogsBtn.addEventListener('click', showMobileLogsModal);
    }
    
    // 開始測試按鈕
    const mobileStartTest = document.getElementById('mobileStartTest');
    if (mobileStartTest) {
        mobileStartTest.addEventListener('click', startMobileTest);
    }
    
    // 複製結果按鈕
    const mobileCopyResult = document.getElementById('mobileCopyResult');
    if (mobileCopyResult) {
        mobileCopyResult.addEventListener('click', copyMobileResult);
    }
}

// 開始手機版測試
async function startMobileTest() {
    if (!mobileSelectedNode) return;
    
    const targetHost = document.getElementById('mobileTargetHost').value.trim();
    const testType = document.getElementById('mobileTestType').value;
    
    if (!targetHost) {
        alert('請輸入目標主機');
        return;
    }
    
    const testButton = document.getElementById('mobileStartTest');
    const resultsContainer = document.getElementById('mobileTestResults');
    const resultTitle = document.getElementById('mobileResultTitle');
    const resultContent = document.getElementById('mobileResultContent');
    
    // 更新UI狀態
    testButton.disabled = true;
    testButton.textContent = '測試中...';
    resultsContainer.classList.remove('d-none');
    resultTitle.textContent = `${mobileSelectedNode.name_zh || mobileSelectedNode.name} - ${testType.toUpperCase()}`;
    resultContent.textContent = '正在執行測試，請稍候...';
    
    try {
        // 記錄使用日誌
        await logUsage('test_started', {
            nodeName: mobileSelectedNode.name,
            nodeLocation: mobileSelectedNode.location,
            testType: testType,
            target: targetHost
        });
        
        // 發送測試請求
        const response = await safeApiRequest('https://api.globalping.io/v1/measurements', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                type: testType,
                target: targetHost,
                limit: 1,
                locations: [{
                    magic: mobileSelectedNode.tags
                }]
            })
        });
        
        const data = await response.json();
        
        if (data.id) {
            mobileCurrentTest = data.id;
            // 輪詢測試結果
            pollMobileTestResult(data.id);
        } else {
            throw new Error('測試創建失敗');
        }
        
    } catch (error) {
        resultContent.textContent = `測試失敗: ${error.message}`;
        testButton.disabled = false;
        testButton.textContent = '重新測試';
    }
}

// 輪詢手機版測試結果
async function pollMobileTestResult(testId) {
    const resultContent = document.getElementById('mobileResultContent');
    const testButton = document.getElementById('mobileStartTest');
    
    try {
        const response = await safeApiRequest(`https://api.globalping.io/v1/measurements/${testId}`);
        const data = await response.json();
        
        if (data.status === 'finished') {
            // 測試完成，顯示結果
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                const output = result.result.output || result.result.rawOutput || '測試完成，但無輸出內容';
                
                // 格式化結果以適應手機顯示
                const testType = document.getElementById('mobileTestType').value;
                formatMobileTestResult(resultContent, output, testType);
            } else {
                resultContent.textContent = '測試完成，但沒有結果';
            }
            
            testButton.disabled = false;
            testButton.textContent = '重新測試';
            
        } else if (data.status === 'in-progress') {
            // 繼續輪詢
            setTimeout(() => pollMobileTestResult(testId), 2000);
            
        } else {
            // 測試失敗
            resultContent.textContent = `測試狀態異常: ${data.status}`;
            testButton.disabled = false;
            testButton.textContent = '重新測試';
        }
        
    } catch (error) {
        resultContent.textContent = `獲取結果失敗: ${error.message}`;
        testButton.disabled = false;
        testButton.textContent = '重新測試';
    }
}

// 複製手機版測試結果
async function copyMobileResult() {
    const resultContent = document.getElementById('mobileResultContent');
    let text;
    
    // 如果內容已格式化，獲取純文本版本
    if (resultContent.classList.contains('formatted')) {
        // 從格式化的HTML中提取純文本
        text = extractPlainTextFromFormatted(resultContent);
    } else {
        text = resultContent.textContent;
    }
    
    try {
        await navigator.clipboard.writeText(text);
        
        const copyBtn = document.getElementById('mobileCopyResult');
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="bi bi-check"></i>';
        
        setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
        }, 2000);
        
    } catch (err) {
        // 降級方案
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        alert('結果已複製到剪貼簿');
    }
}

// 從格式化的HTML內容中提取純文本
function extractPlainTextFromFormatted(container) {
    let text = '';
    
    // 遍歷所有子元素
    const elements = container.querySelectorAll('.hop-line, .ping-line');
    
    if (elements.length > 0) {
        elements.forEach(element => {
            const hopNumber = element.querySelector('.hop-number');
            const hopIP = element.querySelector('.hop-ip');
            const hopTime = element.querySelector('.hop-time');
            
            if (hopNumber && hopIP && hopTime) {
                // Traceroute/MTR 格式
                text += `${hopNumber.textContent} ${hopIP.textContent} ${hopTime.textContent}\n`;
            } else {
                // Ping 或其他格式
                text += element.textContent + '\n';
            }
        });
    } else {
        // 如果沒有找到格式化元素，使用原始文本
        text = container.textContent;
    }
    
    return text;
}

// 更新手機版主題圖標
function updateMobileThemeIcon() {
    const mobileThemeToggle = document.getElementById('mobileThemeToggle');
    if (!mobileThemeToggle) return;
    
    const icon = mobileThemeToggle.querySelector('i');
    const currentTheme = document.documentElement.getAttribute('data-theme');
    
    if (currentTheme === 'dark') {
        icon.className = 'bi bi-sun-fill';
    } else {
        icon.className = 'bi bi-moon-fill';
    }
}

// 響應式檢測和初始化
function handleResponsiveChanges() {
    if (window.innerWidth <= 768) {
        // 切換到手機版
        if (nodesData && nodesData.nodes && nodesData.nodes.length > 0) {
            initMobileVersion();
        }
    }
}

// 監聽窗口大小變化
window.addEventListener('resize', handleResponsiveChanges);

// === 手機版統計功能 ===

// 顯示手機版統計模態框
async function showMobileStatsModal() {
    const modal = document.getElementById('mobileStatsModal');
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    
    modalInstance.show();
    
    // 載入統計數據
    await loadMobileStats();
}

// 載入手機版統計數據
async function loadMobileStats() {
    const container = document.getElementById('mobileStatsContent');
    
    try {
        container.innerHTML = `
            <div class="text-center">
                <div class="spinner-border" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
            </div>
        `;
        
        // 獲取統計數據
        const probes = await fetchProbesData();
        const stats = await calculateStats(probes);
        
        // 渲染手機版統計UI
        renderMobileStats(stats);
        
    } catch (error) {
        console.error('載入手機版統計失敗:', error);
        container.innerHTML = `
            <div class="alert alert-danger">
                載入統計數據失敗：${error.message}
            </div>
        `;
    }
}

// 渲染手機版統計數據
function renderMobileStats(stats) {
    const container = document.getElementById('mobileStatsContent');
    
    // 計算百分比
    const onlinePercentage = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
    
    // 計算地區分佈
    const continentStats = {
        asia: 0,
        europe: 0,
        northAmerica: 0,
        southAmerica: 0,
        oceania: 0,
        africa: 0
    };
    
    stats.nodeDetails.forEach(node => {
        const continent = getNodeContinent(node);
        if (continentStats.hasOwnProperty(continent)) {
            continentStats[continent]++;
        }
    });
    
    container.innerHTML = `
        <!-- 總體統計 -->
        <div class="mobile-stats-card">
            <h6>節點概況</h6>
            <div class="mobile-stats-grid">
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${stats.total}</div>
                    <div class="mobile-stat-label">總節點數</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${stats.online}</div>
                    <div class="mobile-stat-label">線上節點</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${stats.offline}</div>
                    <div class="mobile-stat-label">下線節點</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${onlinePercentage}%</div>
                    <div class="mobile-stat-label">上線率</div>
                </div>
            </div>
        </div>
        
        <!-- 地區分佈 -->
        <div class="mobile-stats-card">
            <h6>地區分佈</h6>
            <div class="mobile-stats-grid">
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${continentStats.asia}</div>
                    <div class="mobile-stat-label">亞洲</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${continentStats.europe}</div>
                    <div class="mobile-stat-label">歐洲</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${continentStats.northAmerica}</div>
                    <div class="mobile-stat-label">北美洲</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${continentStats.southAmerica}</div>
                    <div class="mobile-stat-label">南美洲</div>
                </div>
            </div>
        </div>
        
        <!-- 節點狀態詳情 -->
        <div class="mobile-stats-card">
            <h6>節點狀態</h6>
            <div class="mobile-node-status-list">
                ${stats.nodeDetails.map(node => `
                    <div class="mobile-node-status-item">
                        <div class="node-info">
                            <div class="node-name">${node.name_zh || node.name}</div>
                            <div class="node-location">${node.location_zh || node.location}</div>
                        </div>
                        <span class="status-badge ${node.status}">
                            ${node.status === 'online' ? '線上' : '下線'}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// === 手機版日誌功能 ===

// 顯示手機版日誌模態框
async function showMobileLogsModal() {
    const modal = document.getElementById('mobileLogsModal');
    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    
    modalInstance.show();
    
    // 載入日誌數據
    await loadMobileLogs();
}

// 載入手機版日誌數據
async function loadMobileLogs() {
    const container = document.getElementById('mobileLogsContent');
    
    try {
        container.innerHTML = `
            <div class="text-center">
                <div class="spinner-border" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
            </div>
        `;
        
        // 獲取日誌數據
        let logs = [];
        
        // 優先從伺服器獲取
        if (CONFIG && CONFIG.USE_JSONBIN && CONFIG.JSONBIN_ID && CONFIG.JSONBIN_API_KEY) {
            try {
                const response = await fetch(`${CONFIG.JSONBIN_BASE_URL}/b/${CONFIG.JSONBIN_ID}/latest`, {
                    headers: {
                        'X-Master-Key': CONFIG.JSONBIN_API_KEY
                    }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.record && result.record.logs) {
                        logs = result.record.logs.slice(0, 50); // 只顯示最近50條
                    }
                }
            } catch (error) {
                console.log('從伺服器獲取日誌失敗，使用本地日誌');
            }
        }
        
        // 如果伺服器沒有數據，使用本地數據
        if (logs.length === 0) {
            logs = usageLogs.slice(-50).reverse(); // 最近50條，倒序顯示
        }
        
        // 渲染手機版日誌UI
        renderMobileLogs(logs);
        
    } catch (error) {
        console.error('載入手機版日誌失敗:', error);
        container.innerHTML = `
            <div class="alert alert-danger">
                載入日誌數據失敗：${error.message}
            </div>
        `;
    }
}

// 渲染手機版日誌數據
function renderMobileLogs(logs) {
    const container = document.getElementById('mobileLogsContent');
    
    if (logs.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                <i class="bi bi-info-circle me-2"></i>
                暫無使用記錄
            </div>
        `;
        return;
    }
    
    // 分析統計數據
    const analysis = analyzeLogs(logs);
    
    container.innerHTML = `
        <!-- 使用統計 -->
        <div class="mobile-stats-card">
            <h6>使用統計</h6>
            <div class="mobile-stats-grid">
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${analysis.totalTests}</div>
                    <div class="mobile-stat-label">次測試</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${analysis.uniqueTargets}</div>
                    <div class="mobile-stat-label">根目標</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${analysis.uniqueUsers}</div>
                    <div class="mobile-stat-label">使用者IP</div>
                </div>
                <div class="mobile-stat-item">
                    <div class="mobile-stat-value">${analysis.nodeUsageEfficiency}%</div>
                    <div class="mobile-stat-label">節點使用率</div>
                </div>
            </div>
        </div>
        
        <!-- 最近測試 -->
        <div class="mobile-stats-card">
            <h6>最近測試</h6>
            <div class="mobile-node-status-list">
                ${logs.slice(0, 20).map(log => `
                    <div class="mobile-node-status-item">
                        <div class="node-info">
                            <div class="node-name">
                                ${log.target || 'N/A'} 
                                <span style="font-size: 0.8em; color: var(--text-muted);">
                                    (${log.testType ? log.testType.toUpperCase() : 'N/A'})
                                </span>
                            </div>
                            <div class="node-location">
                                ${log.nodeName || 'N/A'} • ${formatTime(log.timestamp)}
                            </div>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">
                            ${log.ip || 'N/A'}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// 分析日誌數據
function analyzeLogs(logs) {
    const analysis = {
        totalTests: logs.length,
        uniqueTargets: new Set(logs.map(log => log.target).filter(Boolean)).size,
        uniqueUsers: new Set(logs.map(log => log.ip).filter(Boolean)).size,
        nodeUsageEfficiency: 0
    };
    
    // 計算節點使用率
    const usedNodes = new Set(logs.map(log => log.nodeName).filter(Boolean));
    const totalNodes = nodesData ? nodesData.nodes.length : 0;
    analysis.nodeUsageEfficiency = totalNodes > 0 ? Math.round((usedNodes.size / totalNodes) * 100) : 0;
    
    return analysis;
}

// 格式化時間（手機版簡化版本）
function formatTime(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return '剛剛';
        if (diffMins < 60) return `${diffMins}分鐘前`;
        if (diffHours < 24) return `${diffHours}小時前`;
        if (diffDays < 7) return `${diffDays}天前`;
        
        return date.toLocaleDateString('zh-TW');
    } catch (error) {
        return 'N/A';
    }
}

// 格式化手機版測試結果
function formatMobileTestResult(container, output, testType) {
    if (!output || typeof output !== 'string') {
        container.textContent = '測試完成，但無輸出內容';
        return;
    }
    
    // 根據測試類型進行不同的格式化
    switch (testType) {
        case 'traceroute':
        case 'mtr':
            formatMobileTracerouteResult(container, output);
            break;
        case 'ping':
            formatMobilePingResult(container, output);
            break;
        default:
            container.textContent = output;
            break;
    }
}

// 格式化手機版 Traceroute/MTR 結果
function formatMobileTracerouteResult(container, output) {
    container.className = 'result-content formatted';
    container.innerHTML = '';
    
    const lines = output.split('\n');
    let formattedHTML = '';
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // 檢測跳躍行（通常包含數字開頭）
        const hopMatch = trimmedLine.match(/^\s*(\d+)\s+(.+)/);
        if (hopMatch) {
            const hopNumber = hopMatch[1];
            const hopData = hopMatch[2];
            
            // 提取IP地址和時間
            const ipMatch = hopData.match(/(\d+\.\d+\.\d+\.\d+|\[?[0-9a-fA-F:]+\]?)/);
            const timeMatch = hopData.match(/(\d+\.?\d*)\s*ms/g);
            
            let hopIP = 'Unknown';
            let hopTimes = '';
            
            if (ipMatch) {
                hopIP = ipMatch[1];
            }
            
            if (timeMatch) {
                hopTimes = timeMatch.join(' ');
            }
            
            formattedHTML += `
                <div class="hop-line">
                    <span class="hop-number">${hopNumber}</span>
                    <span class="hop-ip">${hopIP}</span>
                    <span class="hop-time">${hopTimes}</span>
                </div>
            `;
        } else if (trimmedLine.includes('ms') || trimmedLine.includes('timeout') || trimmedLine.includes('*')) {
            // 處理其他包含時間信息的行
            formattedHTML += `<div class="hop-line">${trimmedLine}</div>`;
        } else {
            // 其他信息行
            formattedHTML += `<div style="margin-bottom: 0.5rem; color: var(--text-muted); font-size: 0.9em;">${trimmedLine}</div>`;
        }
    }
    
    if (formattedHTML) {
        container.innerHTML = formattedHTML;
    } else {
        // 如果格式化失敗，顯示原始輸出
        container.className = 'result-content';
        container.textContent = output;
    }
}

// 格式化手機版 Ping 結果
function formatMobilePingResult(container, output) {
    container.className = 'result-content formatted';
    container.innerHTML = '';
    
    const lines = output.split('\n');
    let formattedHTML = '';
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // 檢測ping回應行
        if (trimmedLine.includes('bytes from') && trimmedLine.includes('time=')) {
            formattedHTML += `<div class="ping-line">${trimmedLine}</div>`;
        } else if (trimmedLine.includes('PING') || trimmedLine.includes('ping statistics') || 
                   trimmedLine.includes('packets transmitted') || trimmedLine.includes('min/avg/max')) {
            formattedHTML += `<div style="margin: 0.5rem 0; font-weight: 500; color: var(--text-color);">${trimmedLine}</div>`;
        } else {
            formattedHTML += `<div style="margin-bottom: 0.25rem; color: var(--text-muted);">${trimmedLine}</div>`;
        }
    }
    
    if (formattedHTML) {
        container.innerHTML = formattedHTML;
    } else {
        // 如果格式化失敗，顯示原始輸出
        container.className = 'result-content';
        container.textContent = output;
    }
}

// === 背景監控系統 ===

// 背景監控：定期檢查離線節點
function startBackgroundMonitoring() {
    // 清除現有定時器
    if (backgroundMonitorTimer) {
        clearInterval(backgroundMonitorTimer);
    }
    
    // 每60秒檢查一次離線節點
    backgroundMonitorTimer = setInterval(async () => {
        console.log('🔍 背景監控：檢查離線節點...');
        
        // 檢查API使用量，如果太高就跳過這次檢查
        if (apiRequestCount >= MAX_API_REQUESTS_PER_MINUTE * 0.9) {
            console.log('⏭️ API使用量過高，跳過背景檢查');
            return;
        }
        
        await checkOfflineNodesInBackground();
    }, 60000); // 每分鐘檢查一次
    
    console.log('✅ 背景監控已啟動');
}

// 背景檢查離線節點
async function checkOfflineNodesInBackground() {
    const savedCache = localStorage.getItem('nodeStatusCache');
    if (!savedCache) return;
    
    try {
        const cacheData = JSON.parse(savedCache);
        const offlineNodes = [];
        
        // 找出所有離線節點
        for (const [nodeKey, nodeData] of Object.entries(cacheData)) {
            if (nodeData.status === 'offline' || nodeData.status === 'error') {
                offlineNodes.push(nodeKey);
            }
        }
        
        if (offlineNodes.length === 0) {
            console.log('📱 沒有離線節點需要檢查');
            return;
        }
        
        console.log(`🔄 背景檢查 ${offlineNodes.length} 個離線節點: ${offlineNodes.join(', ')}`);
        
        // 檢查前2個離線節點（避免太多API請求）
        const nodesToCheck = offlineNodes.slice(0, 2);
        
        for (const nodeKey of nodesToCheck) {
            try {
                // 強制刷新這個節點的緩存
                forceRefreshNodeStatus(nodeKey);
                
                // 重新檢查節點狀態
                const node = nodesData.nodes.find(n => n.tags === nodeKey);
                if (node) {
                    await checkSingleNodeStatus(node, true); // 強制檢查
                    console.log(`✅ 已重新檢查節點: ${nodeKey}`);
                }
                
                // 避免太快發送請求
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`❌ 背景檢查節點 ${nodeKey} 失敗:`, error);
            }
        }
    } catch (error) {
        console.error('❌ 背景監控錯誤:', error);
    }
}

// 停止背景監控
function stopBackgroundMonitoring() {
    if (backgroundMonitorTimer) {
        clearInterval(backgroundMonitorTimer);
        backgroundMonitorTimer = null;
        console.log('⏹️ 背景監控已停止');
    }
}