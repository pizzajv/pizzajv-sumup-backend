// api/sumup.js - Endpoint SumUp sécurisé
export default async function handler(req, res) {
  const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
  const SUMUP_MERCHANT_ID = process.env.SUMUP_MERCHANT_ID;

  // Validation basique
  if (!SUMUP_API_KEY || !SUMUP_MERCHANT_ID) {
    return res.status(500).json({ error: 'Variables d\'environnement manquantes' });
  }

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
        // Récupère les transactions SumUp des 7 derniers jours
        const seventhDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
        
        const response = await fetch(
          `https://api.sumup.com/v0.1/me/transactions?limit=${limit}&oldest_transaction_id=${seventhDaysAgo}`,
          {
            headers: {
              'Authorization': `Bearer ${SUMUP_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`SumUp API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Format les transactions pour l'app
        const transactions = (data.items || []).map(tx => ({
          id: tx.id,
          amount: tx.amount / 100, // SumUp en centimes
          currency: tx.currency,
          status: tx.status,
          date: tx.timestamp,
          paymentMethod: tx.payment_method || 'card',
          receiptNumber: tx.receipt_number,
          customerEmail: tx.customer?.email || null,
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
      return res.status(200).json({
        connected: true,
        merchantId: SUMUP_MERCHANT_ID,
        lastCheck: new Date().toISOString()
      });
    }
  }

  // POST /api/sumup - Webhook receiver from SumUp
  if (req.method === 'POST') {
    const { event, data } = req.body;

    // Valide la requête SumUp (signature webhook)
    // À implémenter avec la signature SumUp si nécessaire

    if (event === 'transaction.completed') {
      // Une transaction est complète
      console.log('Transaction complétée:', data);
      
      return res.status(200).json({
        success: true,
        message: 'Webhook reçu',
        transaction: {
          sumupId: data.id,
          amount: data.amount / 100,
          status: data.status,
          date: data.timestamp
        }
      });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
