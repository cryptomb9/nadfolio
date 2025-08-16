export default async function handler(req, res) {
  try {
    const response = await fetch('https://testnet-api.monorail.xyz/v1/tokens', {
      headers: {
        'X-App-ID': '2495175533099910',
        'Accept': 'application/json',
        'User-Agent': 'NadFolio/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Monorail API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    res.json(data);
  } catch (error) {
    console.error('Monorail tokens proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Monorail tokens data',
      message: error.message 
    });
  }
}