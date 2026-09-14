/* api/proxy.js — serverless CORS proxy for Roblox public APIs.
   users.roblox.com / thumbnails.roblox.com / friends.roblox.com send no
   Access-Control-Allow-Origin header, so browsers can't fetch them directly.
   Relaying through this function makes the /widgets Roblox card work. */
const ALLOW = ['users.roblox.com', 'thumbnails.roblox.com', 'friends.roblox.com'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const q = new URL(req.url, 'https://proxy.local');
    const target = q.searchParams.get('url');
    if (!target) {
      res.status(400).json({ success: false, error: 'url is required' });
      return;
    }
    let t;
    try { t = new URL(target); } catch { res.status(400).json({ success: false, error: 'bad url' }); return; }
    if (!ALLOW.includes(t.hostname)) {
      res.status(403).json({ success: false, error: 'domain not allowed' });
      return;
    }
    const resp = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' }
    });
    const text = await resp.text();
    res.setHeader('Content-Type', resp.headers.get('Content-Type') || 'application/json; charset=utf-8');
    res.status(resp.status).send(text);
  } catch (e) {
    res.status(502).json({ success: false, error: 'proxy upstream error' });
  }
};