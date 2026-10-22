# 進度與交接

最後更新：2026-10-22（commit `7973807` 之後）

架構、指令、程式碼位置請見 [CLAUDE.md](CLAUDE.md)；本文件記錄**目前狀態、進行中的工作與待辦**。

## 快速上手

| 項目 | 內容 |
|------|------|
| 正式站 | https://stock.omg.st |
| Repo | https://github.com/leeyihua/stock-dashboard-site |
| 部署 | push `master` → GitHub Actions 自動 `wrangler deploy`（約 20–30 秒） |
| 本地開發 | `npx wrangler dev`，需在專案根目錄建立 `.dev.vars`：`FUGLE_API_KEY=...` |
| 機密 | `FUGLE_API_KEY`（Cloudflare Worker Secret）、`CLOUDFLARE_API_TOKEN`（GitHub Actions Secret） |

## 功能狀態

| 功能 | 狀態 | 備註 |
|------|------|------|
| 台股／美股日 K 查詢 | ✅ | Worker `/api/quote`（Yahoo），台股中文名由 Fugle 補 |
| 即時報價（每分鐘） | ✅ | 台股 Fugle、美股 Yahoo；成交量統一為「股」 |
| 中文名稱搜尋 | ✅ | Fugle tickers |
| 技術分析面板＋買賣評分 | ✅ | |
| 2560 戰法訊號面板 | ✅ | 2026-10-22 新增 |
| ETF 持有清單（台股） | ✅ | Google Apps Script，回應約 5 秒 |
| 個股新聞（台股中文） | ⚠️ | 大型股相關性佳；小型股只拿到一般台股新聞 |
| 個股新聞（美股） | ⚠️ | 約 1/3 與個股直接相關 |
| 2560 全市場選股 | 🔜 | 設計完成，待決定執行環境（見下方） |
| 法人買賣超 | ❌ | Fugle / FinMind 免費版不支援 |
| Staging 環境 | ❌ | 未設定 |

## 2026-10-22 變更紀錄

| Commit | 內容 |
|--------|------|
| `38cfd1f` | CLAUDE.md 改寫為 Cloudflare Workers 架構；`.gitignore` 加入 `.wrangler/` |
| `487e343` | `.assetsignore` 排除 `static/`（舊版備份不再公開，已驗證 404） |
| `e7f5731` | 修正台股即時成交量單位：Fugle `tradeVolume` 為「張」，Worker 乘 1000 轉為「股」；更新 header 資料源說明 |
| `7973807` | 新增 2560 戰法訊號面板 |

### 2560 戰法訊號面板設計

- 位置：全寬，在「中長線看法」之後、ETF 清單之前（不影響既有面板排列）
- K 線圖**刻意不加** MA25，避免動到既有面板
- 不納入 `buildRecommendation()` 評分，僅為獨立參考
- 「回踩」門檻 3% 為自訂值（網路流傳規則無統一標準），可依需求調整
- 盤中跌破 25 日線顯示「盤中跌破」，提示以收盤確認

## 進行中：2560 全市場選股（每日列出符合股票）

**待決定**：Cloudflare Workers 是免費版還是付費版，決定運算放哪裡。

已驗證可用的資料源（2026-10-22 實測）：

| API | 用途 | 結果 |
|-----|------|------|
| `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` | 上市當日全市場 | 1,383 筆，0.07s |
| `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | 上櫃當日全市場 | 12,950 筆（含權證需過濾），約 5MB |
| `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999` | 上市歷史某日（回補用） | 1,377 筆，約 5s/日 |

規劃架構：

```
一次性回補約 80 個交易日 → 存 KV
每個交易日 16:00（台北）
  → 抓上市 + 上櫃當日行情（2 個請求）→ 更新各股最近 80 日資料
  → 對約 1,800 檔普通股跑 2560 判斷（沿用 render2560Panel 的邏輯，需抽成共用函式）
  → 結果寫入 KV
Worker 新增 /api/screen2560 → 前端「2560 選股」清單，點擊進入個股分析
```

- **付費版**：Worker Cron Trigger + KV
- **免費版**（CPU 10ms 可能不夠）：改用 GitHub Actions 排程運算，結果寫入 KV 或 repo
- 建議加流動性過濾（例如 5 日均量 < 500 張排除）
- 限制：官方行情未還原除權息；美股無免費全市場 API，建議先只做台股；上櫃歷史回補端點尚未驗證

## 其他待辦（依優先度）

1. 台股中文新聞：wantgoo `/investrue/{id}/news/list?index=1` 回 400，需用瀏覽器 DevTools 抓實際 request header/cookie。已失敗的方案：Google News RSS（Worker IP 被擋 503）、Yahoo 中文查詢（400）、Yahoo `lang=zh-TW`（空結果）
2. 美股新聞相關性：Yahoo search 以代號查詢，混入大量一般財經新聞，可考慮依標題／`relatedTickers` 過濾
3. Cloudflare edge cache（`caches.default`）減少重複打 Yahoo
4. 歷史 K 線改走 Fugle `historical/candles`
5. Staging 環境

## 開發注意事項

- **新增檔案要檢查 `.assetsignore`**：`wrangler.toml` 以整個專案目錄為靜態資產，未排除的檔案都會公開（本文件已排除）
- **成交量單位**：前端一律以「股」計算，`fmtVol()` 顯示為「K」（台股 1 K 股 = 1 張）
- **zsh 下 curl 含 `?` 的網址要加引號**，否則會被當成萬用字元
- **驗證方式**：
  - API：`curl -s "https://stock.omg.st/api/quote?symbol=2330.TW"`
  - 畫面：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1520,3200 --virtual-time-budget=20000 --screenshot=out.png https://stock.omg.st/`
  - 無頭 Chrome 有最小視窗寬度，390px 手機截圖右側會被裁切，屬截圖假象，非網站問題
- 首頁預設載入 2317 鴻海，無 URL 參數可指定代號
