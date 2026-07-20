// api/sumup.js - Endpoint SumUp sécurisé (OAuth2)
//
// Remplace l'ancienne authentification par clé API statique (qui posait
// probleme sur l'endpoint transactions) par un flux OAuth2 refresh_token :
// a chaque appel, on echange le refresh_token contre un access_token frais
// (valable ~1h), puis on l'utilise pour interroger l'API SumUp.

let cachedToken = null; // { accessToken, expiresAt } - cache memoire (reset a froid entre invocations Vercel)

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30000) {
    return cachedToken.accessToken;
  }

  const CLIENT_ID = process.env.SUMUP_CLIENT_ID;
  const CLIENT_SECRET = process.env.SUMUP_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SUMUP_REFRESH_TOKEN;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Variables OAuth manquantes (SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET / SUMUP_REFRESH_TOKEN). Autorisation initiale requise via /api/callback.');
  }

  const response = await fetch('https://api.sumup.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Rafraichissement du token SumUp echoue: ${data.error || response.status} - ${data.error_description || ''}`);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 3600000)
  };

  // Note: SumUp peut renvoyer un nouveau refresh_token a chaque rafraichissement.
  // S'il differe de celui stocke dans Vercel, il faudra le mettre a jour manuellement
  // (cette route logue un avertissement dans ce cas pour que Thomas le remarque).
  if (data.refresh_token && data.refresh_token !== REFRESH_TOKEN) {
    console.warn('⚠️ SumUp a renvoye un NOUVEAU refresh_token. Pense a mettre a jour SUMUP_REFRESH_TOKEN dans Vercel:', data.refresh_token);
  }

  return cachedToken.accessToken;
}

export default async function handler(req, res) {
  const SUMUP_MERCHANT_ID = process.env.SUMUP_MERCHANT_ID; // optionnel, informatif uniquement

  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET /api/sumup?action=getTransactions
  if (req.method === 'GET') {
    const { action, limit = 50 } = req.query;

    if (action === 'getTransactions') {
      try {
        const accessToken = await getAccessToken();

        // Récupère les transactions SumUp des 7 derniers jours
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const response = await fetch(
          `https://api.sumup.com/v0.1/me/transactions/history?limit=${limit}&oldest_time=${sevenDaysAgo}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`SumUp API error: ${response.status} - ${errBody}`);
        }

        const data = await response.json();

        // Formate les transactions pour l'app
        const transactions = (data.items || []).map(tx => ({
          id: tx.id,
          amount: tx.amount,
          currency: tx.currency,
          status: tx.status,
          date: tx.timestamp,
          paymentMethod: tx.payment_type || 'card',
          transactionCode: tx.transaction_code,
          sumupId: tx.id
        }));

        return res.status(200).json({
          success: true,
          count: transactions.length,
          transactions,
          lastSync: new Date().toISOString()
        });
      } catch (error) {
        console.error('SumUp fetch error:', error);
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }

    if (action === 'status') {
      try {
        await getAccessToken(); // vérifie que le refresh fonctionne
        return res.status(200).json({
          connected: true,
          merchantId: SUMUP_MERCHANT_ID || null,
          lastCheck: new Date().toISOString()
        });
      } catch (error) {
        return res.status(200).json({
          connected: false,
          error: error.message,
          lastCheck: new Date().toISOString()
        });
      }
    }
  }

  // POST /api/sumup - Webhook receiver from SumUp (non prioritaire pour l'instant)
  if (req.method === 'POST') {
    const { event, data } = req.body || {};

    if (event === 'transaction.completed') {
      console.log('Transaction complétée (webhook):', data);
      return res.status(200).json({
        success: true,
        message: 'Webhook reçu',
        transaction: {
          sumupId: data.id,
          amount: data.amount,
          status: data.status,
          date: data.timestamp
        }
      });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
