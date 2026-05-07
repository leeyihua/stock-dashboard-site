const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/quote') return handleQuote(url.searchParams);
    if (url.pathname === '/api/live')  return handleLive(url.searchParams);
    return env.ASSETS.fetch(request);
  },
};

async function fetchYahooChart(yfSym, range) {
  for (const host of YAHOO_HOSTS) {
    const apiUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=1d&range=${range}`;
    try {
      const res = await fetch(apiUrl, { headers: YAHOO_HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data?.chart?.result?.[0]) throw new Error('chart.result 為空');
      return data;
    } catch (e) {
      console.warn(`Worker: ${host} 失敗 —`, e.message);
    }
  }
  return null;
}

async function handleQuote(params) {
  const symbol = params.get('symbol');
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const yfSym = symbol.toUpperCase();
  const isTW = yfSym.endsWith('.TW') || yfSym.endsWith('.TWO');
  const twId = isTW ? yfSym.replace(/\.(TW|TWO)$/, '') : null;

  // FinMind 與 Yahoo 平行發出，互不等待
  const finmindPromise = isTW
    ? Promise.race([
        fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${encodeURIComponent(twId)}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]).catch(() => null)
    : Promise.resolve(null);

  const data = await fetchYahooChart(yfSym, '8mo');
  if (!data) return jsonResponse({ error: `無法取得 ${yfSym} 的資料` }, 502);

  if (isTW) {
    try {
      const infoRes = await finmindPromise;
      if (infoRes?.ok) {
        const chName = (await infoRes.json())?.data?.[0]?.stock_name;
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
}

async function handleLive(params) {
  const symbol = params.get('symbol');
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const data = await fetchYahooChart(symbol.toUpperCase(), '1d');
  if (!data) return jsonResponse({ error: `無法取得 ${symbol} 即時報價` }, 502);

  const m = data.chart.result[0].meta;
  if (!m?.regularMarketPrice) return jsonResponse({ error: '無 regularMarketPrice' }, 502);

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
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
