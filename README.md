# 智能股票分析儀表板

純前端靜態網站，輸入台股 / 美股代號即可顯示完整技術分析儀表板（K 線、均線、成交量、RSI、MACD、KD、買賣建議）。

---

## 本機預覽

直接開啟 `index.html` 會因 CORS 無法抓取資料，需透過 HTTP server 啟動：

```bash
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000
```

---

## 支援的代號格式

| 市場 | 範例 | 說明 |
|------|------|------|
| 台股上市 | `2317`、`2330` | 自動加 `.TW` |
| 台股上櫃 | `6488.TWO` | 需手動加 `.TWO` |
| 台股特別股／受益憑證 | `00981A` | 支援字母後綴 |
| 美股 | `AAPL`、`TSLA`、`NVDA` | 直接輸入 |
| ETF | `0050`、`SPY`、`QQQ` | 同上 |

---

## 資料來源

1. **Twelve Data API**（需自行申請免費 Key，800 次/日）— 填入網站右上角欄位
2. **FinMind**（台股免費，無需 Key）
3. **Yahoo Finance + CORS proxy 備援鏈**（自動 fallback）

---

## 授權

MIT
