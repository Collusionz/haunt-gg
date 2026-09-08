/* api/yt.js — serverless proxy for the free savenow v2 YouTube download API.
   The savenow endpoint rejects browser requests from non-partner origins
   (it checks the Origin/Referer header). A server-side request carries no
   Origin header, so relaying through this function works from this domain. */
const UPSTREAM = 'https://p.savenow.to';
const API_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const q = new URL(req.url, 'https://yt.local');
    const id = q.searchParams.get('id');
    let target;
    if (id) {
      target = UPSTREAM + '/api/progress?id=' + encodeURIComponent(id);
    } else {
      const u = q.searchParams.get('url') || '';
      const f = q.searchParams.get('format') || '';
      if (!u || !f) {
        res.status(400).json({ success: false, error: 'url and format are required' });
        return;
      }
      const p = new URLSearchParams();
      p.set('url', u);
      p.set('format', f);
      const quality = q.searchParams.get('quality');
      if (quality) p.set('quality', quality);
      p.set('apikey', API_KEY);
      target = UPSTREAM + '/api/v2/download?' + p.toString();
    }
    const resp = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' }
    });
    const text = await resp.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(resp.status).send(text);
  } catch (e) {
    res.status(502).json({ success: false, error: 'proxy upstream error' });
  }
};