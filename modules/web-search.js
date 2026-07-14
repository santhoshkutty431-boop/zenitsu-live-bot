// ─── WEB SEARCH MODULE ────────────────────────────────────────────────────────
// Uses DuckDuckGo Instant Answer API (free, no key needed) as primary.
// Falls back to a structured DuckDuckGo HTML scrape for broader queries.
// Returns clean, AI-readable result strings.

const https = require('https');

const SEARCH_TIMEOUT = 8000; // 8 seconds max

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleOk  = (v) => { if (!settled) { settled = true; resolve(v); } };
    const settleErr = (e) => { if (!settled) { settled = true; reject(e); } };

    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ZenitsuAI/1.0)',
        'Accept':     'application/json',
      },
      timeout: SEARCH_TIMEOUT,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => settleOk({ status: res.statusCode, body: raw }));
      res.on('error', settleErr);
    });

    req.on('error', settleErr);
    req.on('timeout', () => {
      req.destroy();
      settleErr(new Error('Search request timed out'));
    });

    const watchdog = setTimeout(() => {
      if (!settled) { req.destroy(); settleErr(new Error('Search watchdog timeout')); }
    }, SEARCH_TIMEOUT + 1000);

    req.on('close', () => clearTimeout(watchdog));
  });
}

// ─── DUCKDUCKGO INSTANT ANSWER ────────────────────────────────────────────────
async function searchDuckDuckGo(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

  const { body } = await httpsGet(url);
  const data = JSON.parse(body);

  const results = [];

  // Abstract (best single-source answer)
  if (data.AbstractText) {
    results.push(`📌 **${data.AbstractSource || 'Summary'}**: ${data.AbstractText}`);
    if (data.AbstractURL) results.push(`🔗 ${data.AbstractURL}`);
  }

  // Answer (instant answers like calculations, conversions, etc.)
  if (data.Answer) {
    results.push(`⚡ **Instant Answer**: ${data.Answer}`);
  }

  // Definition (for word lookups)
  if (data.Definition) {
    results.push(`📖 **Definition**: ${data.Definition}`);
    if (data.DefinitionURL) results.push(`🔗 ${data.DefinitionURL}`);
  }

  // Related Topics (top 4)
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
    const topics = data.RelatedTopics
      .filter(t => t.Text && !t.Topics) // exclude nested topic groups
      .slice(0, 4)
      .map(t => `• ${t.Text}${t.FirstURL ? `\n  🔗 ${t.FirstURL}` : ''}`);
    if (topics.length > 0) {
      results.push(`\n🔎 **Related Results**:\n${topics.join('\n')}`);
    }
  }

  // Infobox (structured data like weather, sports, etc.)
  if (data.Infobox && data.Infobox.content && data.Infobox.content.length > 0) {
    const infoItems = data.Infobox.content
      .slice(0, 5)
      .map(item => `• **${item.label}**: ${item.value}`)
      .join('\n');
    results.push(`\n📊 **Info**:\n${infoItems}`);
  }

  if (results.length === 0) {
    return null; // No instant answer found, caller should note this
  }

  return results.join('\n').slice(0, 2000); // Cap at 2000 chars for AI context
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
async function webSearch(query) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { success: false, error: 'Invalid search query.' };
  }

  const q = query.trim().slice(0, 200); // max 200 char query
  console.log(`[WEB SEARCH] Searching: "${q}"`);

  try {
    const result = await searchDuckDuckGo(q);

    if (result) {
      console.log(`[WEB SEARCH] Found results for: "${q}"`);
      return { success: true, results: result, query: q };
    } else {
      // No instant answer — return a helpful "no results" with a search link
      const searchLink = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
      return {
        success: true,
        results: `No instant results found for "${q}". You can search manually here: ${searchLink}`,
        query: q,
        noInstantAnswer: true,
      };
    }
  } catch (err) {
    console.error(`[WEB SEARCH] Error for query "${q}":`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { webSearch };
