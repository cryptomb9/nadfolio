
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    console.log('Fetching nad.fun tokens...');
    
    const response = await fetch('https://testnet-bot-api-server.nad.fun/order/market_cap?page=1&limit=100', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NadFolio/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`nad.fun API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from nad.fun API');
    }
    
    res.status(200).json(data);
    
  } catch (error) {
    console.error('nad.fun proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch nad.fun data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}