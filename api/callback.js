// api/callback.js - Callback OAuth2 SumUp
// Reçoit le "code" après que Thomas a autorisé l'application sur SumUp,
// l'échange contre un access_token + refresh_token.
//
// A visiter UNE SEULE FOIS (autorisation initiale), en se rendant sur
// l'URL /authorize construite avec le client_id (voir README ou message Claude).
//
// Le refresh_token affiché ici doit être copié dans Vercel :
// Settings -> Environment Variables -> SUMUP_REFRESH_TOKEN
// Il ne sera plus jamais réaffiché après avoir quitté cette page.

export default async function handler(req, res) {
  const CLIENT_ID = process.env.SUMUP_CLIENT_ID;
  const CLIENT_SECRET = process.env.SUMUP_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send(renderPage({
      error: "Variables SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET manquantes sur Vercel."
    }));
  }

  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(renderPage({
      error: `SumUp a refusé l'autorisation : ${error} - ${error_description || ''}`
    }));
  }

  if (!code) {
    return res.status(400).send(renderPage({
      error: "Aucun code d'autorisation reçu. Cette page doit être atteinte via une redirection SumUp, pas visitée directement."
    }));
  }

  // Construit dynamiquement le redirect_uri exact utilisé pour la requête
  // (doit correspondre EXACTEMENT à celui enregistré dans l'app OAuth2 SumUp)
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${req.headers.host}/api/callback`;

  try {
    const tokenResponse = await fetch('https://api.sumup.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(400).send(renderPage({
        error: `Échec de l'échange du code : ${tokenData.error || tokenResponse.status} - ${tokenData.error_description || ''}`
      }));
    }

    return res.status(200).send(renderPage({
      success: true,
      refreshToken: tokenData.refresh_token,
      scope: tokenData.scope
    }));

  } catch (err) {
    return res.status(500).send(renderPage({
      error: `Erreur serveur pendant l'échange du token : ${err.message}`
    }));
  }
}

function renderPage({ error, success, refreshToken, scope }) {
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  if (error) {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Erreur - PizzaJV SumUp</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 20px;color:#3D3429;}
.box{background:#fbeaea;border:1px solid #d4704c;border-radius:8px;padding:20px;}</style>
</head><body>
<h2>❌ Connexion SumUp échouée</h2>
<div class="box">${escapeHtml(error)}</div>
</body></html>`;
  }

  if (success) {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>SumUp connecté - PizzaJV</title>
<style>
body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 20px;color:#3D3429;}
.box{background:#f5f1e8;border:1px solid #d4a574;border-radius:8px;padding:20px;margin:16px 0;}
.token{background:#3D3429;color:#F5F1E8;padding:14px;border-radius:6px;font-family:monospace;
  word-break:break-all;font-size:14px;user-select:all;}
.warn{background:#fbeaea;border:1px solid #d4704c;border-radius:8px;padding:16px;margin-top:20px;}
code{background:#eee;padding:2px 6px;border-radius:4px;}
</style></head><body>
<h2>✅ SumUp connecté avec succès</h2>
<p>Portée accordée : <code>${escapeHtml(scope)}</code></p>

<div class="box">
  <strong>Refresh token (à copier maintenant) :</strong>
  <div class="token">${escapeHtml(refreshToken)}</div>
</div>

<div class="warn">
  <strong>⚠️ Cette page ne se réaffichera pas.</strong><br>
  Copie ce refresh token maintenant dans Vercel :<br>
  <code>pizzajv-sumup-backend</code> → Settings → Environment Variables →
  <code>SUMUP_REFRESH_TOKEN</code><br><br>
  Puis redéploie le projet pour que la variable soit prise en compte.
</div>
</body></html>`;
  }

  return `<!DOCTYPE html><html><body><p>État inattendu.</p></body></html>`;
}
