const MONAD_PARAMS = {
  chainId: "0x279F", // 10143 in decimal
  chainName: "Monad Testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18
  },
  rpcUrls: [
    "https://rpc-testnet.monadinfra.com",
    "https://rpc.ankr.com/monad_testnet",
    "https://testnet-rpc.monad.xyz"
  ],
  blockExplorerUrls: ["https://testnet.monadexplorer.com"]
};

// API Configuration
const MONORAIL_CONFIG = {
  appId: "2495175533099910",
  dataEndpoint: "https://testnet-api.monorail.xyz/v1",
  quoteEndpoint: "https://testnet-pathfinder.monorail.xyz/v4"
};

const openOceanAPI = "https://open-api.openocean.finance/v4/monad/tokenList";
const nadFunListAPI = "/api/nad-tokens";
const monorailTokensAPI = "/api/monorail-tokens"; 
const monorailWalletAPI = "/api/monorail-wallet"; 

let provider, signer, account;
let chartInstance;
let exchangeRates = { USD: 1 };
let currentCurrency = 'USD';
let originalPortfolioData = null;
let tokenMetadata = {};
let monUsdPrice = 0;

// Cache for performance optimization
const cache = {
  tokenMetadata: new Map(),
  balances: new Map(),
  prices: new Map(),
  lastUpdate: 0,
  CACHE_DURATION: 30000 // 30 seconds
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  if (typeof ethers === 'undefined') {
    console.error('Ethers.js not loaded!');
    showError('Failed to load required libraries. Please refresh the page.');
    return;
  }
  
  document.getElementById("connectBtn").addEventListener("click", connectWallet);
  document.getElementById("currencySelect").addEventListener("change", handleCurrencyChange);
  
  // Start loading immediately and in parallel
  Promise.all([
    loadExchangeRates(),
    initTokenMetadata()
  ]).then(() => {
    console.log('Initial data loaded');
  }).catch(error => {
    console.error('Error loading initial data:', error);
  });
  
  // Check if already connected
  if (window.ethereum && window.ethereum.selectedAddress) {
    autoConnect();
  }
});

// Handle account changes
if (typeof window !== 'undefined' && window.ethereum) {
  window.ethereum.on('accountsChanged', function (accounts) {
    if (accounts.length === 0) {
      resetApp();
    } else {
      account = accounts[0];
      updateConnectedState();
      loadPortfolio();
    }
  });

  window.ethereum.on('chainChanged', function (chainId) {
    if (chainId === MONAD_PARAMS.chainId) {
      if (account) {
        loadPortfolio();
      }
    } else {
      showError("Please switch to Monad Testnet");
    }
  });
}

// Optimized Monorail API functions (via proxy)
async function fetchMonorailTokens() {
  try {
    console.log('Fetching from Monorail API via proxy...');
    console.log('Note: This requires a backend proxy due to CORS restrictions');
    const startTime = Date.now();
    
    const response = await fetch(monorailTokensAPI, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Monorail proxy responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    let addedCount = 0;
    
    if (data && Array.isArray(data)) {
      data.forEach(token => {
        try {
          const addr = token.address?.toLowerCase();
          if (!addr || tokenMetadata[addr]) return;
          
          tokenMetadata[addr] = {
            symbol: token.symbol || 'UNKNOWN',
            name: token.name || token.symbol || 'Unknown Token',
            decimals: token.decimals || 18,
            logo: token.logoURI || token.icon || '',
            usd: parseFloat(token.priceUSD || 0),
            verified: true,
            source: 'monorail'
          };
          
          // Cache the token data
          cache.tokenMetadata.set(addr, tokenMetadata[addr]);
          addedCount++;
          
          if (token.symbol === "MON") {
            monUsdPrice = parseFloat(token.priceUSD || 0);
          }
        } catch (tokenError) {
          console.warn('Error processing Monorail token:', tokenError);
        }
      });
    }
    
    console.log(`Monorail tokens loaded: ${addedCount} tokens in ${Date.now() - startTime}ms`);
    return addedCount;
  } catch (error) {
    console.warn('Failed to fetch Monorail tokens - proxy not available or CORS restricted:', error.message);
    console.log('To access Monorail data, you need to create a backend proxy at /api/monorail-tokens');
    return 0;
  }
}

async function fetchMonorailTokenPrice(contractAddress) {
  try {
    // This would also need a proxy, but for now we'll skip individual token prices
    // and rely on the bulk token list from fetchMonorailTokens
    console.log('Individual Monorail token price fetching disabled due to CORS');
    return 0;
  } catch (error) {
    console.warn(`Failed to fetch price for ${contractAddress}:`, error);
  }
  return 0;
}

async function fetchMonorailWalletBalances(walletAddress) {
  try {
    console.log('Attempting to fetch wallet balances from Monorail via proxy...');
    console.log('Note: This requires a backend proxy due to CORS restrictions');
    
    const response = await fetch(`${monorailWalletAPI}/${walletAddress}`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Monorail balances via proxy:', data);
      return data;
    } else {
      throw new Error(`Proxy responded with status: ${response.status}`);
    }
  } catch (error) {
    console.warn('Failed to fetch Monorail wallet balances - proxy not available or CORS restricted:', error.message);
    console.log('To access Monorail wallet data, you need to create a backend proxy at /api/monorail-wallet');
  }
  return null;
}

// Optimized OpenOcean fetch
async function fetchOpenOceanTokens() {
  try {
    console.log('Fetching from OpenOcean API...');
    const startTime = Date.now();
    
    const res = await fetch(openOceanAPI);
    const data = await res.json();
    
    if (data.code === 200 && Array.isArray(data.data)) {
      let addedCount = 0;
      data.data.forEach((t) => {
        const addr = t.address.toLowerCase();
        if (!tokenMetadata[addr]) {
          tokenMetadata[addr] = {
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            logo: t.icon,
            usd: parseFloat(t.usd),
            verified: true,
            source: 'openocean'
          };
          cache.tokenMetadata.set(addr, tokenMetadata[addr]);
          addedCount++;
        }
        
        if (t.symbol === "MON") monUsdPrice = parseFloat(t.usd);
      });
      
      console.log(`OpenOcean tokens loaded: ${addedCount} tokens in ${Date.now() - startTime}ms`);
      return addedCount;
    }
  } catch (error) {
    console.warn('Failed to fetch OpenOcean tokens:', error);
  }
  return 0;
}

// Optimized nad.fun fetch
async function fetchNadFunTokens() {
  try {
    console.log('Fetching from nad.fun API...');
    const startTime = Date.now();
    
    const res = await fetch(nadFunListAPI, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!res.ok) {
      throw new Error(`nad.fun API responded with status: ${res.status}`);
    }
    
    const json = await res.json();
    
    if (json.order_token && Array.isArray(json.order_token)) {
      let addedCount = 0;
      json.order_token.forEach((ot) => {
        try {
          const addr = ot.token_info?.token_address?.toLowerCase();
          if (!addr || tokenMetadata[addr]) return;
          
          const monPrice = parseFloat(ot.market_info?.price) || 0;
          const usdPrice = monUsdPrice && monPrice ? monPrice * monUsdPrice : 0;
          
          tokenMetadata[addr] = {
            symbol: ot.token_info.symbol,
            name: ot.token_info.name,
            decimals: ot.token_info.decimals || 18,
            logo: ot.token_info.image_uri,
            usd: usdPrice,
            verified: false,
            source: 'nadfun'
          };
          
          cache.tokenMetadata.set(addr, tokenMetadata[addr]);
          addedCount++;
        } catch (tokenError) {
          console.warn('Error processing nad.fun token:', tokenError);
        }
      });
      
      console.log(`nad.fun tokens loaded: ${addedCount} tokens in ${Date.now() - startTime}ms`);
      return addedCount;
    }
  } catch (error) {
    console.warn('Failed to fetch nad.fun tokens:', error.message);
  }
  return 0;
}

// Super fast token metadata initialization with parallel loading
async function initTokenMetadata() {
  console.log('Initializing token metadata with parallel loading...');
  const startTime = Date.now();
  
  try {
    // Check cache first
    if (cache.lastUpdate && (Date.now() - cache.lastUpdate) < cache.CACHE_DURATION) {
      console.log('Using cached token metadata');
      tokenMetadata = Object.fromEntries(cache.tokenMetadata);
      return;
    }
    
    // Show loading indicator
    const tokenCount = document.getElementById("tokenCount");
    const originalText = tokenCount.textContent;
    tokenCount.textContent = "Loading token data...";
    
    // Load all APIs in parallel for maximum speed
    const promises = [
      fetchOpenOceanTokens(),
      fetchMonorailTokens(),
      fetchNadFunTokens()
    ];
    
    const results = await Promise.allSettled(promises);
    const totalAdded = results
      .filter(result => result.status === 'fulfilled')
      .reduce((sum, result) => sum + (result.value || 0), 0);
    
    // Set fallback MON price if not found
    if (!monUsdPrice) {
      console.warn("MON price not found from any API, using fallback");
      monUsdPrice = 0.01;
    }
    
    const totalTokens = Object.keys(tokenMetadata).length;
    const loadTime = Date.now() - startTime;
    
    console.log(`🚀 Token metadata loaded: ${totalTokens} tokens in ${loadTime}ms`);
    
    // Update cache
    cache.lastUpdate = Date.now();
    
    // Reset the token count text
    tokenCount.textContent = originalText;
    
    // Log breakdown by source
    const sources = {};
    Object.values(tokenMetadata).forEach(token => {
      sources[token.source] = (sources[token.source] || 0) + 1;
    });
    console.log('Tokens by source:', sources);
    
  } catch (error) {
    console.error('Error initializing token metadata:', error);
    const tokenCount = document.getElementById("tokenCount");
    tokenCount.textContent = "0 tokens";
  }
}

// Enhanced price fetching (fallback to existing metadata)
async function getBestTokenPrice(address, balance) {
  const addr = address.toLowerCase();
  
  // Check cache first
  if (cache.prices.has(addr)) {
    const cachedPrice = cache.prices.get(addr);
    if (cachedPrice.timestamp && (Date.now() - cachedPrice.timestamp) < 60000) { // 1 minute cache
      return cachedPrice.price;
    }
  }
  
  // For now, just return the existing metadata price since Monorail APIs need proxies
  const token = tokenMetadata[addr];
  if (token && token.usd > 0) {
    // Cache the existing price
    cache.prices.set(addr, {
      price: token.usd,
      timestamp: Date.now()
    });
    return token.usd;
  }
  
  console.log(`No price available for token ${address}. Consider adding more price sources or proxy endpoints.`);
  return 0;
}

// Get token USD value from metadata
function getTokenUsdValue(address, balanceRaw, decimals) {
  const meta = tokenMetadata[address.toLowerCase()];
  if (!meta) return { value: 0, price: 0 };
  
  const balance = balanceRaw / (10 ** (meta.decimals || decimals || 18));
  const usdValue = balance * (meta.usd || 0);
  
  return { value: usdValue, price: meta.usd || 0 };
}

// Currency functions
function getCurrencySymbol(currency) {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£', 
    JPY: '¥',
    NGN: '₦'
  };
  return symbols[currency] || '$';
}

function formatCurrency(amount, currency = currentCurrency) {
  const convertedAmount = amount * (exchangeRates[currency] || 1);
  const symbol = getCurrencySymbol(currency);
  
  if (currency === 'JPY') {
    return `${symbol}${Math.round(convertedAmount).toLocaleString()}`;
  }
  
  return `${symbol}${convertedAmount.toFixed(2)}`;
}

async function loadExchangeRates() {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    exchangeRates = {
      USD: 1,
      EUR: data.rates.EUR || 0.85,
      GBP: data.rates.GBP || 0.73,
      JPY: data.rates.JPY || 110,
      NGN: data.rates.NGN || 415
    };
    console.log('Exchange rates loaded:', exchangeRates);
  } catch (error) {
    console.warn('Failed to load exchange rates, using fallback rates:', error);
    exchangeRates = { USD: 1, EUR: 0.85, GBP: 0.73, JPY: 110, NGN: 415 };
  }
}

function handleCurrencyChange(event) {
  currentCurrency = event.target.value;
  console.log('Currency changed to:', currentCurrency);
  
  if (account && originalPortfolioData) {
    updateCurrencyDisplay();
  }
}

function updateCurrencyDisplay() {
  if (!originalPortfolioData) return;
  
  // Update total balance
  document.getElementById("totalBalance").textContent = formatCurrency(originalPortfolioData.totalUSD);
  
  // Update all token values
  const tokenItems = document.querySelectorAll('.token-usd');
  tokenItems.forEach((item, index) => {
    if (originalPortfolioData.tokenUSDValues[index] !== undefined) {
      item.textContent = formatCurrency(originalPortfolioData.tokenUSDValues[index]);
    }
  });
  
  // Update token prices
  const tokenPrices = document.querySelectorAll('.token-price');
  tokenPrices.forEach((item, index) => {
    if (originalPortfolioData.tokenPrices[index] !== undefined) {
      item.textContent = formatCurrency(originalPortfolioData.tokenPrices[index]);
    }
  });
  
  // Update chart
  if (chartInstance && originalPortfolioData.chartValues.length > 0) {
    const convertedValues = originalPortfolioData.chartValues.map(usdValue => 
      usdValue * (exchangeRates[currentCurrency] || 1)
    );
    renderChart(originalPortfolioData.chartLabels, convertedValues, originalPortfolioData.chartColors);
  }
}

// UI functions
function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    
    setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  }
}

function showLoading(show) {
  const loadingDiv = document.getElementById("loadingMessage");
  if (loadingDiv) {
    loadingDiv.style.display = show ? "block" : "none";
  }
}

function updateConnectedState() {
  const connectBtn = document.getElementById("connectBtn");
  const networkInfo = document.getElementById("networkInfo");
  
  if (connectBtn) {
    if (account) {
      connectBtn.textContent = account.slice(0, 6) + "..." + account.slice(-4);
      connectBtn.disabled = false;
      if (networkInfo) networkInfo.style.display = "inline-block";
    } else {
      connectBtn.textContent = "Connect Wallet";
      connectBtn.disabled = false;
      if (networkInfo) networkInfo.style.display = "none";
    }
  }
}

function resetApp() {
  account = null;
  provider = null;
  signer = null;
  originalPortfolioData = null;
  
  updateConnectedState();
  
  const totalBalance = document.getElementById("totalBalance");
  const tokenList = document.getElementById("tokenList");
  const tokenCount = document.getElementById("tokenCount");
  const emptyChart = document.getElementById("emptyChart");
  
  if (totalBalance) totalBalance.textContent = formatCurrency(0);
  if (tokenList) tokenList.innerHTML = "";
  if (tokenCount) tokenCount.textContent = "0 tokens";
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  if (emptyChart) emptyChart.style.display = "block";
}

// Network functions
async function ensureMonadNetwork() {
  try {
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    console.log("Current chain ID:", currentChainId);
    
    if (currentChainId !== MONAD_PARAMS.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: MONAD_PARAMS.chainId }]
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [MONAD_PARAMS]
          });
        } else {
          throw switchError;
        }
      }
    }
  } catch (error) {
    console.error("Network switch error:", error);
    throw new Error("Failed to switch to Monad Testnet");
  }
}

async function autoConnect() {
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      account = accounts[0];
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      
      updateConnectedState();
      
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId === MONAD_PARAMS.chainId) {
        await loadPortfolio();
      }
    }
  } catch (error) {
    console.error("Auto-connect error:", error);
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    showError("MetaMask is required. Please install MetaMask to continue.");
    return;
  }

  try {
    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting...";
    }

    await ensureMonadNetwork();

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found");
    }

    account = accounts[0];
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();

    updateConnectedState();
    console.log("Connected to:", account);
    await loadPortfolio();

  } catch (error) {
    console.error("Connection error:", error);
    showError(error.message || "Failed to connect wallet");
    updateConnectedState();
  }
}

// Super optimized portfolio loading
async function loadPortfolio() {
  try {
    showLoading(true);
    console.log("🚀 Loading portfolio with maximum speed...");
    const startTime = Date.now();
    
    // Wait for token metadata to be loaded if still loading
    if (Object.keys(tokenMetadata).length === 0) {
      console.log("Waiting for token metadata...");
      await initTokenMetadata();
    }
    
    let totalUSD = 0;
    const tokenElements = [];
    const chartLabels = [];
    const chartValues = [];
    const chartColors = [];
    let tokensWithBalance = 0;
    const tokenPricesForStorage = [];
    const tokenUSDValuesForStorage = [];

    // Try to get balances from Monorail first (faster)
    const monorailBalances = await fetchMonorailWalletBalances(account);
    
    // Get all token addresses from metadata
    const tokenAddresses = Object.keys(tokenMetadata);
    console.log(`Checking ${tokenAddresses.length} tokens for balances...`);

    // Create batch requests for better performance
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
      batches.push(tokenAddresses.slice(i, i + BATCH_SIZE));
    }

    // Process batches in parallel
    const batchPromises = batches.map(batch => processBatch(batch, monorailBalances));
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Collect results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        for (const tokenData of result.value) {
          if (tokenData.balance > 0) {
            tokensWithBalance++;
            const usdValue = tokenData.balance * tokenData.price;
            
            if (usdValue >= 0.01) {
              totalUSD += usdValue;
              chartLabels.push(tokenData.token.symbol);
              chartValues.push(usdValue);
              chartColors.push(generateColor(tokenData.token.symbol));
            }

            tokenElements.push(createTokenElement(
              tokenData.token, 
              tokenData.balance, 
              usdValue, 
              tokenData.price, 
              true, 
              tokenData.address
            ));
            tokenPricesForStorage.push(tokenData.price);
            tokenUSDValuesForStorage.push(usdValue);
          }
        }
      }
    }

    const loadTime = Date.now() - startTime;
    console.log(`🚀 Portfolio loaded in ${loadTime}ms: ${tokensWithBalance} tokens with balance, Total USD: $${totalUSD.toFixed(2)}`);

    // Store original USD data for currency conversion
    originalPortfolioData = {
      totalUSD: totalUSD,
      tokenUSDValues: tokenUSDValuesForStorage,
      tokenPrices: tokenPricesForStorage,
      chartLabels: chartLabels,
      chartValues: chartValues,
      chartColors: chartColors
    };

    // Update UI
    const totalBalanceEl = document.getElementById("totalBalance");
    const tokenCountEl = document.getElementById("tokenCount");
    const tokenListEl = document.getElementById("tokenList");
    
    if (totalBalanceEl) totalBalanceEl.textContent = formatCurrency(totalUSD);
    if (tokenCountEl) tokenCountEl.textContent = `${tokensWithBalance} tokens with balance`;
    if (tokenListEl) tokenListEl.innerHTML = tokenElements.join("");

    // Update chart
    if (chartLabels.length > 0) {
      renderChart(chartLabels, chartValues, chartColors);
      const emptyChart = document.getElementById("emptyChart");
      if (emptyChart) emptyChart.style.display = "none";
    } else {
      const emptyChart = document.getElementById("emptyChart");
      if (emptyChart) emptyChart.style.display = "block";
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
    }

  } catch (error) {
    console.error("Portfolio load error:", error);
    showError(error.message || "Failed to load portfolio data");
  } finally {
    showLoading(false);
  }
}

async function processBatch(tokenAddresses, monorailBalances) {
  const results = [];
  
  // Process tokens in parallel within the batch
  const promises = tokenAddresses.map(async (tokenAddress) => {
    const token = tokenMetadata[tokenAddress];
    let formattedBalance = 0;
    let tokenPrice = token.usd || 0;
    
    try {
      // Check Monorail balances first if available
      if (monorailBalances && Array.isArray(monorailBalances)) {
        const monorailBalance = monorailBalances.find(b => 
          b.contractAddress?.toLowerCase() === tokenAddress.toLowerCase()
        );
        
        if (monorailBalance) {
          formattedBalance = parseFloat(monorailBalance.balance || 0);
        }
      }
      
      // Fallback to direct contract call if not found in Monorail or balance is 0
      if (formattedBalance === 0) {
        if (tokenAddress === "0x0000000000000000000000000000000000000000") {
          // Native MON token
          const rawBalance = await provider.getBalance(account);
          formattedBalance = Number(ethers.utils.formatEther(rawBalance));
        } else {
          // ERC-20 token
          const tokenContract = new ethers.Contract(
            tokenAddress, 
            ["function balanceOf(address owner) view returns (uint256)"], 
            provider
          );
          
          const rawBalance = await tokenContract.balanceOf(account);
          formattedBalance = Number(ethers.utils.formatUnits(rawBalance, token.decimals));
        }
      }

      // Get better price if current price is 0 and token has balance
      if (tokenPrice === 0 && formattedBalance > 0) {
        tokenPrice = await getBestTokenPrice(tokenAddress, formattedBalance);
      }
      
      return {
        address: tokenAddress,
        token: token,
        balance: formattedBalance,
        price: tokenPrice
      };

    } catch (tokenError) {
      console.warn(`Error checking balance for ${token.symbol}:`, tokenError.message);
      return {
        address: tokenAddress,
        token: token,
        balance: 0,
        price: tokenPrice
      };
    }
  });
  
  const batchResults = await Promise.allSettled(promises);
  
  for (const result of batchResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    }
  }
  
  return results;
}

function createTokenElement(token, balance, usdValue, price, hasBalance, address) {
  const balanceClass = hasBalance ? 'has-balance' : '';
  const verifiedBadge = token.verified ? '<span class="verified-badge">✓</span>' : '';
  
  return `
    <div class="token-item ${balanceClass}" title="Address: ${address}">
      <div class="token-info">
        <div class="token-icon">
          <img src="${token.logo}" alt="${token.symbol}" 
               onerror="this.style.display='none'; this.parentElement.innerHTML='${token.symbol.charAt(0)}'" />
        </div>
        <div class="token-details">
          <h4>${token.name} ${verifiedBadge}</h4>
          <div class="token-symbol">${token.symbol}</div>
          <div class="token-price">${formatCurrency(price)}</div>
          <div class="token-source" style="font-size: 0.75rem; color: #6b7280; margin-top: 2px;">${token.source}</div>
        </div>
      </div>
      <div class="token-value">
        <div class="token-balance">${balance.toFixed(4)}</div>
        <div class="token-usd">${formatCurrency(usdValue)}</div>
      </div>
    </div>
  `;
}

function generateColor(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

function renderChart(labels, values, colors) {
  const ctx = document.getElementById("portfolioChart");
  if (!ctx) {
    console.warn('Chart canvas not found');
    return;
  }
  
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  chartInstance = new Chart(ctx.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#1e293b',
        hoverBorderWidth: 3,
        hoverBorderColor: '#e2e8f0'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#e2e8f0',
            padding: 20,
            usePointStyle: true,
            font: {
              size: 12,
              weight: '500'
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(248, 250, 252, 0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${formatCurrency(value)} (${percentage}%)`;
            }
          }
        }
      },
      cutout: '60%',
      animation: {
        animateRotate: true,
        duration: 1000
      }
    }
  });
}