export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/quote') {
      return handleQuote(url.searchParams);
    }

    if (url.pathname === '/api/live') {
      return handleLive(url.searchParams);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleQuote(params) {
  const symbol = params.get('symbol');
  if (!symbol) {
    return jsonResponse({ error: '缺少 symbol 參數' }, 400);
  }

  const yfSym = symbol.toUpperCase();
  const isTW = yfSym.endsWith('.TW') || yfSym.endsWith('.TWO');
  const twId = isTW ? yfSym.replace(/\.(TW|TWO)$/, '') : null;

  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of hosts) {
    const apiUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=1d&range=8mo`;
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data?.chart?.result?.[0]) throw new Error('chart.result 為空');

      // 台股：從 FinMind 補中文股名
      if (isTW && twId) {
        try {
          const infoUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${encodeURIComponent(twId)}`;
          const infoRes = await Promise.race([
            fetch(infoUrl),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
          ]);
          if (infoRes.ok) {
            const infoJson = await infoRes.json();
            const chName = infoJson?.data?.[0]?.stock_name;
            if (chName) data.chart.result[0].meta.shortName = chName;
          }
        } catch (e) {
          console.warn('FinMind 股名查詢失敗:', e.message);
        }
      }

      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      });
    } catch (e) {
      console.warn(`Worker: ${host} 失敗 —`, e.message);
    }
  }

  return jsonResponse({ error: `無法取得 ${yfSym} 的資料` }, 502);
}

async function handleLive(params) {
  const symbol = params.get('symbol');
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const yfSym = symbol.toUpperCase();
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of hosts) {
    const apiUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=1d&range=1d`;
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const m = data?.chart?.result?.[0]?.meta;
      if (!m?.regularMarketPrice) throw new Error('無 regularMarketPrice');

      return new Response(JSON.stringify({
        price:     m.regularMarketPrice,
        prevClose: m.chartPreviousClose ?? m.previousClose ?? null,
        volume:    m.regularMarketVolume ?? null,
        time:      m.regularMarketTime ?? null,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      console.warn(`Worker live: ${host} 失敗 —`, e.message);
    }
  }

  return jsonResponse({ error: `無法取得 ${yfSym} 即時報價` }, 502);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
