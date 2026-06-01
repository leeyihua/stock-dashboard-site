const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const FUGLE_BASE = 'https://api.fugle.tw/marketdata/v1.0/stock';

// 全域快取，Worker 重啟後失效，每小時更新一次
let _tickersCache = null;
let _tickersCacheTime = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/quote')  return handleQuote(url.searchParams, env);
    if (url.pathname === '/api/live')   return handleLive(url.searchParams, env);
    if (url.pathname === '/api/search') return handleSearch(url.searchParams, env);
    if (url.pathname === '/api/news')   return handleNews(url.searchParams);
    return env.ASSETS.fetch(request);
  },
};

function fugleHeaders(env) {
  return { 'X-API-KEY': env.FUGLE_API_KEY };
}

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

async function handleQuote(params, env) {
  const symbol = params.get('symbol');
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const yfSym = symbol.toUpperCase();
  const isTW = yfSym.endsWith('.TW') || yfSym.endsWith('.TWO');
  const twId = isTW ? yfSym.replace(/\.(TW|TWO)$/, '') : null;

  // 台股：Fugle 取中文名稱，與 Yahoo 平行發出
  const namePromise = (isTW && env.FUGLE_API_KEY)
    ? fetch(`${FUGLE_BASE}/intraday/ticker/${encodeURIComponent(twId)}`, { headers: fugleHeaders(env) })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    : Promise.resolve(null);

  const data = await fetchYahooChart(yfSym, '8mo');
  if (!data) return jsonResponse({ error: `無法取得 ${yfSym} 的資料` }, 502);

  if (isTW) {
    try {
      const ticker = await namePromise;
      if (ticker?.name) data.chart.result[0].meta.shortName = ticker.name;
    } catch (e) {
      console.warn('Fugle ticker 查詢失敗:', e.message);
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

async function handleLive(params, env) {
  const symbol = params.get('symbol');
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const yfSym = symbol.toUpperCase();
  const isTW = yfSym.endsWith('.TW') || yfSym.endsWith('.TWO');

  // 台股 → Fugle 即時報價，失敗時 fallback Yahoo
  if (isTW && env.FUGLE_API_KEY) {
    const twId = yfSym.replace(/\.(TW|TWO)$/, '');
    try {
      const res = await fetch(`${FUGLE_BASE}/intraday/quote/${encodeURIComponent(twId)}`, {
        headers: fugleHeaders(env),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (!d?.lastPrice) throw new Error('無 lastPrice');
      return new Response(JSON.stringify({
        price:     d.lastPrice,
        prevClose: d.previousClose ?? null,
        volume:    d.total?.tradeVolume ?? null,
        // Fugle 時間戳為微秒，轉換為秒
        time:      d.closeTime ? Math.floor(d.closeTime / 1_000_000) : null,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      console.warn('Fugle live 失敗，fallback Yahoo:', e.message);
    }
  }

  // 美股 或 Fugle 失敗 → Yahoo
  const data = await fetchYahooChart(yfSym, '1d');
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

async function fetchTickers(env) {
  const now = Date.now();
  if (_tickersCache && now - _tickersCacheTime < 3_600_000) return _tickersCache;

  const [twse, tpex] = await Promise.all([
    fetch(`${FUGLE_BASE}/intraday/tickers?type=EQUITY&exchange=TWSE`, { headers: fugleHeaders(env) })
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${FUGLE_BASE}/intraday/tickers?type=EQUITY&exchange=TPEx`, { headers: fugleHeaders(env) })
      .then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const list = [
    ...(twse?.data ?? []),
    ...(tpex?.data ?? []),
  ];

  if (list.length > 0) {
    _tickersCache = list;
    _tickersCacheTime = now;
  }
  return list;
}

async function handleSearch(params, env) {
  const q = (params.get('q') || '').trim();
  if (!q) return jsonResponse({ results: [] });
  if (!env.FUGLE_API_KEY) return jsonResponse({ error: '未設定 FUGLE_API_KEY' }, 503);

  const list = await fetchTickers(env);
  const lower = q.toLowerCase();
  const results = list
    .filter(s => s.name?.includes(q) || s.symbol?.toLowerCase().startsWith(lower))
    .slice(0, 8)
    .map(s => ({ symbol: s.symbol, name: s.name }));

  return jsonResponse({ results });
}

async function handleNews(params) {
  const symbol = (params.get('symbol') || '').trim();
  const name   = (params.get('name')   || '').trim();
  if (!symbol) return jsonResponse({ error: '缺少 symbol 參數' }, 400);

  const isTW = /\.(TW|TWO)$/i.test(symbol);
  // 台股優先用中文名稱搜尋，美股用代號
  const rawId = symbol.replace(/\.(TW|TWO)$/i, '');
  const query = isTW ? (name || rawId) : rawId;
  const locale = isTW
    ? 'zh-TW&gl=TW&ceid=TW:zh-Hant'
    : 'en-US&gl=US&ceid=US:en';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale}`;

  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    if (!res.ok) throw new Error('Google News HTTP ' + res.status);
    const xml = await res.text();
    const items = parseRssItems(xml).slice(0, 10);
    return new Response(JSON.stringify({ items }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502);
  }
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    items.push({
      title:   extractXml(b, 'title'),
      link:    extractXml(b, 'link'),
      pubDate: extractXml(b, 'pubDate'),
      source:  extractXml(b, 'source'),
    });
  }
  return items;
}

function extractXml(block, tag) {
  // CDATA
  let m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (m) return m[1].trim();
  // plain
  m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
