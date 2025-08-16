export default async function handler(req, res) {
  try {
    // Extract wallet address from URL path
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    // Validate ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    const response = await fetch(`https://testnet-api.monorail.xyz/v1/wallet/${walletAddress}/balances`, {
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
    console.error('Monorail wallet proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Monorail wallet balances',
      message: error.message 
    });
  }
}