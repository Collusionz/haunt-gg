/* api/presence.js — serverless proxy for Roblox presence (presence.roblox.com).
   Returns online/offline status, last online time, and the game being played.
   Requires POST + no CORS headers, so it goes through this function. */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const q = new URL(req.url, 'https://presence.local');
    const ids = (q.searchParams.get('id') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
    if (!ids.length) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const resp = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      },
      body: JSON.stringify({ userIds: ids })
    });
    const text = await resp.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(resp.status).send(text);
  } catch (e) {
    res.status(502).json({ success: false, error: 'presence upstream error' });
  }
};