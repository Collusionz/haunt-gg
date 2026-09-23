module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send('Missing id');

  try {
    const r = await fetch('https://api.lanyard.rest/v1/users/' + id);
    const j = await r.json();
    if (j && j.success && j.data && j.data.discord_user) {
      const u = j.data.discord_user;
      if (u.avatar) {
        const ext = String(u.avatar).startsWith('a_') ? '.gif' : '.png';
        return res.redirect(302, `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}${ext}?size=256`);
      } else {
        // No avatar set
        let def = 0;
        try { def = Number(BigInt(u.id) >> 22n) % 6; } catch (e) {}
        return res.redirect(302, `https://cdn.discordapp.com/embed/avatars/${def}.png`);
      }
    }
  } catch (e) {}

  try {
    const r2 = await fetch('https://japi.rest/discord/v1/user/' + id);
    const j2 = await r2.json();
    if (j2 && j2.data) {
      if (j2.data.avatar) {
        const ext = String(j2.data.avatar).startsWith('a_') ? '.gif' : '.png';
        return res.redirect(302, `https://cdn.discordapp.com/avatars/${id}/${j2.data.avatar}${ext}?size=256`);
      } else {
        let def = 0;
        try { def = Number(BigInt(id) >> 22n) % 6; } catch (e) {}
        return res.redirect(302, `https://cdn.discordapp.com/embed/avatars/${def}.png`);
      }
    }
  } catch (e) {}

  // Fallback to default avatar
  let def = 0;
  try { def = Number(BigInt(id) >> 22n) % 6; } catch (e) {}
  return res.redirect(302, `https://cdn.discordapp.com/embed/avatars/${def}.png`);
};
