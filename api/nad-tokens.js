export default async function handler(req, res) {
  try {
    const response = await fetch('https://testnet-bot-api-server.nad.fun/order/market_cap?page=1&limit=100');
    const data = await response.json();
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nad.fun data' });
  }
}