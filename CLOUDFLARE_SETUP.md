# Cloudflare Worker + KV 設定指南（2024 新版介面）

由於 Cloudflare Pages 不支援 PHP，我們使用 Cloudflare Workers + KV 來處理日誌記錄。

## 步驟 1：建立 KV Namespace

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 在左側選單找到「Workers & Pages」
3. 點擊「KV」標籤
4. 點擊「Create namespace」
5. 命名為 `lg-logs-kv`（或任何你喜歡的名字）
6. 點擊「Add」

## 步驟 2：建立 Worker

1. 回到「Workers & Pages」主頁
2. 點擊「Create application」
3. 選擇「Create Worker」
4. 給 Worker 一個名字，例如：`lg-logs`
5. 點擊「Deploy」

## 步驟 3：綁定 KV 到 Worker（最重要！）

1. 進入剛建立的 Worker 頁面
2. 點擊上方的「Settings」標籤
3. 往下滾動找到「Bindings」區塊
4. 點擊「Add」按鈕
5. 在彈出的視窗中：
   - **Type**: 選擇「KV Namespace」
   - **Variable name**: 輸入 `LOGS`（⚠️ 必須完全一樣，大寫）
   - **KV namespace**: 從下拉選單選擇 `lg-logs-kv`
6. 點擊「Save」
7. **重要**：看到 "Settings updated" 訊息後，點擊右上角的「Save and Deploy」按鈕

## 步驟 4：部署 Worker 代碼

1. 回到 Worker 的「Code」標籤
2. 點擊「Quick edit」按鈕
3. 刪除預設代碼
4. 將 `worker.js` 的內容完整複製貼上
5. 點擊「Save and deploy」

## 步驟 5：測試 Worker

1. 在 Worker 頁面，複製你的 Worker URL
   - 格式：`https://lg-logs.你的帳號.workers.dev`

2. 首先測試除錯端點（檢查 KV 綁定）：
   ```
   https://lg-logs.你的帳號.workers.dev/api/debug
   ```
   應該看到 `"has_LOGS": true`

3. 如果看到 `"has_LOGS": false`，表示 KV 沒有綁定成功：
   - 回到步驟 3 重新綁定
   - 確認 Variable name 是 `LOGS`（大寫）
   - 確認有點擊 "Save and Deploy"

4. 測試日誌 API：
   ```
   https://lg-logs.你的帳號.workers.dev/api/logs
   ```
   應該回傳：`{"logs":[],"totalRecords":0,"lastUpdate":null}`

## 步驟 6：更新網站配置

1. 編輯 `config.js`
2. 修改以下設定：
   ```javascript
   // 將 USE_JSONBIN 改為 false
   USE_JSONBIN: false,
   
   // 填入你的 Worker URL
   WORKER_URL: 'https://lg-logs.你的帳號.workers.dev',
   
   // 確保啟用日誌
   ENABLE_LOGGING: true
   ```

## 步驟 7：部署到 Cloudflare Pages

1. 提交所有更改到 GitHub
2. Cloudflare Pages 會自動部署更新
3. 等待部署完成（約 1-2 分鐘）

## 驗證設定

1. 開啟你的 Looking Glass 網站
2. 點擊任何節點
3. 執行一些測試
4. 點擊統計面板的「日誌」按鈕
5. 應該能看到剛剛的操作記錄

## 檢視 Worker 日誌

1. 在 Worker 頁面點擊「Logs」標籤
2. 點擊「Begin log stream」
3. 可以即時看到所有請求和錯誤訊息

## 常見問題

### 1. 日誌沒有記錄？
- 檢查瀏覽器 Console 是否有錯誤
- 確認 Worker URL 是否正確（沒有多餘的斜線）
- 檢查 Worker Logs 看是否有錯誤

### 2. CORS 錯誤？
- 確認 Worker 代碼中的 CORS 設定正確
- 可以將 `'*'` 改為你的網域（更安全）

### 3. KV 綁定錯誤？
- 確認 Variable name 必須是 `LOGS`（大寫）
- 確認已經點擊 Save 保存綁定

## 進階功能

Worker 還提供了統計 API：
```
https://lg-logs.你的帳號.workers.dev/api/stats
```
可以獲取使用統計資料。

## 費用

- Workers：每日前 100,000 次請求免費
- KV：每日前 100,000 次讀取免費
- 對一般使用來說完全足夠