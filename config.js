// 配置文件
const CONFIG = {
    // === Cloudflare Worker 設定（推薦）===
    // 請按照 CLOUDFLARE_SETUP.md 的步驟設定 Worker
    // 然後將你的 Worker URL 填入下方
    WORKER_URL: 'https://test-lookingglass-logs.neiljiang064580.workers.dev',  // 例如: 'https://lg-logs.your-account.workers.dev'
    
    // === 備選方案：JSONBin.io ===
    // 如果你不想使用 Cloudflare Worker，可以使用 JSONBin.io
    // 將 USE_JSONBIN 設為 true，並填入相關資訊
    USE_JSONBIN: false,
    JSONBIN_ID: '',  // 例如: '6524f0dc12a5d37659856789'
    JSONBIN_API_KEY: '',  // 例如: '$2b$10$...'
    JSONBIN_BASE_URL: 'https://api.jsonbin.io/v3',
    
    // 是否啟用日誌功能
    ENABLE_LOGGING: true,
    
    // 本地日誌最大數量
    MAX_LOCAL_LOGS: 500,
    
    // 伺服器日誌最大數量
    MAX_SERVER_LOGS: 1000
};