export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/quote') {
      return handleQuote(url.searchParams);
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
  // 依序嘗試 query1 / query2
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
