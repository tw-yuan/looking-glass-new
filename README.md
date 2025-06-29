# Looking Glass - 網路監控工具

**[English](README_EN.md) | 中文**

由一群 BGP Player 維護的開源網路監控專案，提供全球網路節點的連接測試服務，幫助您了解網路連接狀況。

## 🌟 功能特色

- 🌍 **全球節點覆蓋** - 多個地區的網路節點測試點
- 🔍 **多種測試工具**
  - Ping 測試 - 檢測延遲和封包遺失
  - Traceroute 路由追蹤 - 查看網路路徑
  - MTR 綜合分析 - 結合Ping和Traceroute的進階工具
- 📊 **即時測試結果** - 快速獲得準確的網路診斷資訊
- 📱 **響應式設計** - 支援桌面和手機裝置
- 📈 **統計分析** - 節點狀態監控和使用情況分析
- 📝 **使用日誌** - 記錄測試歷史和熱門目標

## 🛠 技術架構

- **前端框架**: Bootstrap 5 + 原生 JavaScript
- **API 整合**: Globalping.io 全球測試網路
- **監控工具**: Smokeping 網路品質監控
- **資料存儲**: localStorage + JSON + Cloudflare Worker
- **版本控制**: GitHub

## 🚀 快速開始

### 線上使用
訪問以下任一網址:
- [https://lg.yuan-tw.net](https://lg.yuan-tw.net)
- [https://lg.zhuyuan.tw](https://lg.zhuyuan.tw)
- [https://lg.c-h.tw](https://lg.c-h.tw)

### 本地部署
```bash
# 克隆專案
git clone https://github.com/tw-yuan/looking-glass-new.git

# 進入專案目錄
cd looking-glass-new

# 使用任意 HTTP 伺服器啟動
python3 -m http.server 8000
# 或使用 Node.js
npx serve .
```

然後開啟瀏覽器訪問 `http://localhost:8000`

## 📋 節點列表

目前支援的測試節點包括：
- 🇹🇼 台灣（台南、新北、台北）
- 🇭🇰 香港
- 🇯🇵 日本（東京）
- 🇸🇬 新加坡
- 🇺🇸 美國（多個城市）
- 🇪🇺 歐洲多國

## 🤝 貢獻指南

### 新增節點
要新增新的測試節點，請提交 Pull Request：

1. Fork 此專案
2. 在 `nodes.json` 中新增節點資訊：
```json
{
  "name": "節點名稱",
  "name_zh": "中文名稱", 
  "location": "City",
  "location_zh": "城市",
  "provider": "提供者",
  "provider-link": "https://provider.com",
  "tags": "provider-tag:node-id",
  "networkType": "Academic/Commercial/CDN",
  "asn": 12345,
  "continent": "asia/europe/america/oceania/africa"
}
```
3. 提交 Pull Request

### 報告問題
如果發現 Bug 或有功能建議，請在 [Issues](https://github.com/tw-yuan/looking-glass-new/issues) 中回報。

## 📊 API 限制

本專案使用 Globalping.io API，有以下限制：
- **未註冊用戶**: 每小時 250 次測試
- **註冊用戶**: 每小時 500 次測試

當達到限制時，系統會顯示警告訊息並告知剩餘重置時間。

## 🔗 相關連結

- [Smokeping 監控](https://smokeping.zhuyuan.tw) - 網路品質長期監控
- [IP 資訊查詢](https://tools.cre0809.com/myip/) - 查詢您的 IP 資訊
- [NCSE Network](https://ncse.tw) - 網路服務提供商

## 📞 聯絡我們

- **Email**: [me@yuan-tw.net](mailto:me@yuan-tw.net)
- **GitHub**: [tw-yuan/looking-glass-new](https://github.com/tw-yuan/looking-glass-new)
- **問題回報**: [GitHub Issues](https://github.com/tw-yuan/looking-glass-new/issues)

## 👥 貢獻者

### 專案維護
- **[Zhuyuan](https://zhuyuan.tw/)**
- **[CH](https://thisisch.net/)**
- **[Yuan](https://yuan-tw.net/)**

### 特別感謝
- **[STUIX](https://stuix.io/)**
- **[CoCoDigit](https://www.cocodigit.com/)**
- **[NCSE Network](https://ncse.tw)**
- **[cute_panda](https://github.com/asdf3601a)**
- **[Ricky](https://www.simple.taipei)**
- **[Cheese_ge](https://cheesege.github.io/)**
- **[Qian](https://blog.qian30.net/)**

## 📄 授權條款

本專案採用 MIT 授權條款 - 詳見 [LICENSE](LICENSE) 文件。

## 🙏 致謝

感謝 [Globalping.io](https://globalping.io) 提供免費的全球網路測試 API，讓這個專案得以實現。

---

**© 2025 Looking Glass @yuan-tw.net, @zhuyuan.tw, @c-h.tw**