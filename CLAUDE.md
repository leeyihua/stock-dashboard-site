# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

純靜態單頁應用程式（Single HTML File），無框架、無 npm、無建置流程。所有邏輯嵌入於 `index.html`（約 1,200 行）中，以繁體中文介面呈現台灣及美股技術分析儀表板。

## 本地開發

無 npm 可用，必須透過 HTTP server 啟動（直接用 `file://` 會因 CORS 政策無法取得股價資料）：

```bash
python3 -m http.server 8000
# 接著開啟 http://localhost:8000
```

## 部署

```bash
npx vercel          # Vercel（推薦）
```

或直接拖拉資料夾至 Netlify Drop。設定檔：`vercel.json`（安全標頭）、`netlify.toml`（快取標頭）。

## 架構

### 資料流

```
使用者輸入股票代號
  → fetchStock() 依序嘗試三個資料源：
      1. Twelve Data API（若有設定 API Key）
      2. Yahoo Finance + 5 個 CORS proxy 備援鏈
      3. Yahoo Finance 替代後綴（.TWO 上櫃股）
  → 計算技術指標（SMA 5/20/60、EMA、RSI-14、MACD 12/26/9、KD 9/3/3）
  → buildRecommendation() 產生買賣訊號
  → 渲染 14 個分析面板（純 SVG 字串拼接，無任何圖表函式庫）
```

### 核心邏輯位置（index.html）

| 功能 | 約略行數 |
|------|--------|
| 資料抓取與備援鏈 | 387–425 |
| 技術指標計算 | 450–548 |
| 推薦評分系統 | 549–612 |
| 面板渲染函式 | 613–1100 |

### 推薦評分邏輯

- **趨勢分數**（+30 ~ -25）：均線排列 + 斜率
- **動能分數**（+15 ~ -10）：RSI、MACD、KD 訊號
- **總分閾值**：≥35 且 RSI<78 → **BUY**；≥18 → **HOLD**；≤-25 → **SELL**；其餘 → **WAIT**
- **勝率**：`clamp(50 + total * 0.5, 5, 95)`

### 資料源細節

- **Twelve Data API**：免費 800 次/天；Key 存於 `localStorage['td_api_key']`
- **CORS proxy 備援順序**：corsproxy.io → allorigins → codetabs → thingproxy → Yahoo 直連
- **代號自動判斷**：4–6 位數字 → 加 `.TW`；字母 → 大寫原樣；上櫃股需手動加 `.TWO`
- **最長 fetch 等待**：每個資料源 12 秒

### 重要限制

- 圖表最多顯示 120 根 K 棒（從抓取的 180 根截取）
- 固定 1480px 寬度，針對桌面設計
- 無任何後端、無資料庫、無驗證機制
