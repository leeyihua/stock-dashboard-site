# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

台股／美股技術分析儀表板，繁體中文介面。無框架、無 npm 依賴、無建置流程。

- **前端**：單一 `index.html`（約 1,650 行），HTML/CSS/JS 全部內嵌
- **後端**：Cloudflare Worker `src/worker.js`，作為 server-side proxy（避開 CORS、隱藏 API Key）
- **正式站**：https://stock.omg.st

## 本地開發

```bash
npx wrangler dev
# 開啟 http://localhost:8787
```

需要 `.dev.vars`（已列入 `.gitignore`）提供 `FUGLE_API_KEY=...`。
只用 `python3 -m http.server` 啟動時 `/api/*` 不存在，前端會退回 FinMind / CORS proxy 備援鏈。

## 部署

push 到 `master` 後由 GitHub Actions（`.github/workflows/deploy.yml`）執行 `wrangler deploy` 自動部署。

- `wrangler.toml`：`[assets] directory = "."`，整個專案目錄即為靜態資產
- `.assetsignore`：排除不應公開的檔案（`.dev.vars`、`src/`、`.git/` 等）；新增檔案時注意是否需加入
- `FUGLE_API_KEY` 為 Cloudflare Worker Secret（`npx wrangler secret put FUGLE_API_KEY`）

## 架構

### Worker 端點（src/worker.js）

| 端點 | 說明 | 資料來源 |
|------|------|--------|
| `GET /api/quote?symbol=` | 日線歷史（range=8mo） | Yahoo Finance（query1/query2 備援）；台股中文名由 Fugle 補 |
| `GET /api/live?symbol=` | 即時報價（no-store） | 台股 Fugle `intraday/quote`，失敗退 Yahoo；美股 Yahoo |
| `GET /api/search?q=` | 中文名稱／代號 autocomplete | Fugle tickers（Worker 記憶體快取 1 小時） |
| `GET /api/news?symbol=&longName=` | 個股新聞 | Yahoo Finance search；台股以英文 `longName` + `lang=zh-Hant-TW` 查詢 |

其餘路徑交給 `env.ASSETS` 回傳靜態檔案。

### 前端資料流（index.html）

```
使用者輸入股票代號（或從 autocomplete 選擇）
  → fetchStock() 依序嘗試：
      1. Worker /api/quote
      2. Twelve Data（若有填 API Key）
      3. FinMind（台股）
      4. Yahoo Finance + CORS proxy 備援鏈（corsproxy.io → allorigins → codetabs → thingproxy → 直連）
      5. Yahoo .TWO 後綴（上櫃股）
  → 計算技術指標（SMA 5/20/60、EMA、RSI-14、MACD 12/26/9、KD 9/3/3）
  → buildRecommendation() 產生買賣訊號
  → 渲染分析面板（純 SVG 字串拼接，無圖表函式庫）
  → 非同步載入：即時報價（每分鐘）、ETF 持有清單（台股）、個股新聞
```

### 核心邏輯位置（index.html）

| 功能 | 函式 | 約略行數 |
|------|------|--------|
| CSS（含 RWD 斷點 1199px / 767px） | — | 1–350 |
| 資料抓取與備援鏈 | `fetchYahoo` / `fetchTwelveData` / `fetchFinMind` / `fetchWorker` / `fetchStock` | 490–650 |
| 技術指標計算 | `sma` / `ema` / `rsi` / `macd` / `kd` | 650–715 |
| 推薦評分系統 | `buildRecommendation` | 715–780 |
| 即時報價 | `fetchLiveQuote` / `updateLiveQuote` / `startLiveQuote` | 795–890 |
| 圖表渲染 | `renderCandles` / `renderVolume` / `renderRSI` / `renderMACD` / `renderKD` / `renderGauge` | 905–1110 |
| 主流程與面板組裝 | `analyze` | 1110–1470 |
| ETF 持有清單 | `fetchEtfHoldings` / `renderEtfPanel`（Google Apps Script `ETF_API`） | 1474–1515 |
| 個股新聞 | `fetchNews` / `renderNewsPanel` | 1518–1565 |
| 搜尋 autocomplete | `doSearch` / `renderDropdown` | 1567–結尾 |

### 推薦評分邏輯

- **趨勢分數**（+60 ~ -50）：價格相對 MA5/20/60 位置 + 均線斜率
- **動能分數**：RSI、MACD（DIF/訊號線、柱狀體變化）、KD 交叉與超買超賣
- **總分閾值**：≥35 且 RSI<78 → **BUY**；≥18 → **HOLD**；≤-25 → **SELL**；其餘 → **WAIT**
- **勝率**：`clamp(50 + total * 0.5, 5, 95)`

### 資料源細節

- **Fugle MarketData API**：`https://api.fugle.tw/marketdata/v1.0/stock`，免費版可用 intraday 與 historical
- **Twelve Data API**：選填，免費 800 次/天；Key 存於 `localStorage['td_api_key']`
- **代號自動判斷**：4–6 位數字（或 4–5 位數字＋1 字母）→ 加 `.TW`，失敗再試 `.TWO`；其餘 → 大寫原樣視為美股
- **fetch 逾時**：Worker 8 秒；其他資料源 12 秒

### 重要限制

- K 線圖最多顯示 120 根（取最近 8 個月資料的尾端）
- 無資料庫、無使用者驗證
- `static/index.html` 為遷移至 Workers 前的純靜態版備份
