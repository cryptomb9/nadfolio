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
    "https://rpc.ankr.com/monad_testnet"
  ],
  blockExplorerUrls: ["https://testnet.monadexplorer.com"]
};

// API Configuration - Fixed endpoints
const openOceanAPI = "https://open-api.openocean.finance/v4/monad/tokenList";
const nadFunListAPI = "https://testnet-bot-api-server.nad.fun/order/market_cap?page=1&limit=100";

let provider, signer, account;
let chartInstance;
let exchangeRates = { USD: 1 };
let currentCurrency = 'USD';
let originalPortfolioData = null;
let tokenMetadata = {};
let monUsdPrice = 0;

// Simplified cache
const cache = {
  tokenMetadata: new Map(),
  lastUpdate: 0,
  CACHE_DURATION: 300000 // 5 minutes
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
  
  // Load data in parallel
  Promise.all([
    loadExchangeRates(),
    initTokenMetadata()
  ]).then(() => {
    console.log('Initial data loaded');
  }).catch(error => {
    console.error('Error loading initial data:', error);
  });
  
  // Auto-connect if available
  if (window.ethereum && window.ethereum.selectedAddress) {
    autoConnect();
  }
});

// Handle account/network changes
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
      if (account) loadPortfolio();
    } else {
      showError("Please switch to Monad Testnet");
    }
  });
}

// Simplified OpenOcean fetch
async function fetchOpenOceanTokens() {
  try {
    console.log('Fetching OpenOcean tokens...');
    const response = await fetch(openOceanAPI);
    const data = await response.json();
    
    if (data.code === 200 && Array.isArray(data.data)) {
      let addedCount = 0;
      data.data.forEach((token) => {
        const addr = token.address?.toLowerCase();
        if (addr && !tokenMetadata[addr]) {
          tokenMetadata[addr] = {
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            logo: token.icon,
            usd: parseFloat(token.usd) || 0,
            verified: true,
            source: 'openocean'
          };
          addedCount++;
          
          if (token.symbol === "MON") {
            monUsdPrice = parseFloat(token.usd) || 0;
          }
        }
      });
      
      console.log(`OpenOcean: ${addedCount} tokens loaded`);
      return addedCount;
    }
  } catch (error) {
    console.warn('OpenOcean fetch failed:', error.message);
  }
  return 0;
}

// Simplified nad.fun fetch with direct API call
async function fetchNadFunTokens() {
  try {
    console.log('Fetching nad.fun tokens...');
    const response = await fetch(nadFunListAPI, {
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`nad.fun API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.order_token && Array.isArray(data.order_token)) {
      let addedCount = 0;
      data.order_token.forEach((item) => {
        try {
          const addr = item.token_info?.token_address?.toLowerCase();
          if (!addr || tokenMetadata[addr]) return;
          
          const monPrice = parseFloat(item.market_info?.price) || 0;
          const usdPrice = monUsdPrice && monPrice ? monPrice * monUsdPrice : 0;
          
          tokenMetadata[addr] = {
            symbol: item.token_info.symbol,
            name: item.token_info.name,
            decimals: item.token_info.decimals || 18,
            logo: item.token_info.image_uri,
            usd: usdPrice,
            verified: false,
            source: 'nadfun'
          };
          addedCount++;
        } catch (err) {
          console.warn('Error processing nad.fun token:', err);
        }
      });
      
      console.log(`nad.fun: ${addedCount} tokens loaded`);
      return addedCount;
    }
  } catch (error) {
    console.warn('nad.fun fetch failed:', error.message);
  }
  return 0;
}

// Add some popular Monad testnet tokens manually
function addKnownTokens() {
  const knownTokens = [
    {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "MON",
      name: "Monad",
      decimals: 18,
      logo: "https://raw.githubusercontent.com/monad-xyz/brand-assets/main/logos/monad-logo.png",
      verified: true
    }
  ];
  
  knownTokens.forEach(token => {
    const addr = token.address.toLowerCase();
    if (!tokenMetadata[addr]) {
      tokenMetadata[addr] = {
        ...token,
        usd: addr === "0x0000000000000000000000000000000000000000" ? (monUsdPrice || 0.01) : 0,
        source: 'known'
      };
    }
  });
}

// Fast token metadata initialization
async function initTokenMetadata() {
  console.log('Loading token metadata...');
  const startTime = Date.now();
  
  // Check cache first
  if (cache.lastUpdate && (Date.now() - cache.lastUpdate) < cache.CACHE_DURATION) {
    console.log('Using cached metadata');
    return;
  }
  
  try {
    // Show loading
    updateTokenCount("Loading...");
    
    // Load APIs in parallel
    const results = await Promise.allSettled([
      fetchOpenOceanTokens(),
      fetchNadFunTokens()
    ]);
    
    // Add known tokens
    addKnownTokens();
    
    const totalTokens = Object.keys(tokenMetadata).length;
    const loadTime = Date.now() - startTime;
    
    console.log(`Token metadata loaded: ${totalTokens} tokens in ${loadTime}ms`);
    
    // Update cache
    cache.lastUpdate = Date.now();
    cache.tokenMetadata = new Map(Object.entries(tokenMetadata));
    
    updateTokenCount(`${totalTokens} tokens available`);
    
  } catch (error) {
    console.error('Token metadata error:', error);
    updateTokenCount("Error loading tokens");
  }
}

// Currency functions
function getCurrencySymbol(currency) {
  const symbols = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', NGN: '₦'
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
  } catch (error) {
    console.warn('Using fallback exchange rates');
    exchangeRates = { USD: 1, EUR: 0.85, GBP: 0.73, JPY: 110, NGN: 415 };
  }
}

function handleCurrencyChange(event) {
  currentCurrency = event.target.value;
  if (account && originalPortfolioData) {
    updateCurrencyDisplay();
  }
}

function updateCurrencyDisplay() {
  if (!originalPortfolioData) return;
  
  document.getElementById("totalBalance").textContent = formatCurrency(originalPortfolioData.totalUSD);
  
  const tokenItems = document.querySelectorAll('.token-usd');
  tokenItems.forEach((item, index) => {
    if (originalPortfolioData.tokenUSDValues[index] !== undefined) {
      item.textContent = formatCurrency(originalPortfolioData.tokenUSDValues[index]);
    }
  });
  
  const tokenPrices = document.querySelectorAll('.token-price');
  tokenPrices.forEach((item, index) => {
    if (originalPortfolioData.tokenPrices[index] !== undefined) {
      item.textContent = formatCurrency(originalPortfolioData.tokenPrices[index]);
    }
  });
  
  if (chartInstance && originalPortfolioData.chartValues.length > 0) {
    const convertedValues = originalPortfolioData.chartValues.map(usdValue => 
      usdValue * (exchangeRates[currentCurrency] || 1)
    );
    renderChart(originalPortfolioData.chartLabels, convertedValues, originalPortfolioData.chartColors);
  }
}

// UI helper functions
function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    setTimeout(() => errorDiv.style.display = "none", 5000);
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
      if (networkInfo) networkInfo.style.display = "inline-block";
    } else {
      connectBtn.textContent = "Connect Wallet";
      if (networkInfo) networkInfo.style.display = "none";
    }
  }
}

function updateTokenCount(text) {
  const tokenCount = document.getElementById("tokenCount");
  if (tokenCount) tokenCount.textContent = text;
}

function resetApp() {
  account = null;
  provider = null;
  signer = null;
  originalPortfolioData = null;
  
  updateConnectedState();
  
  document.getElementById("totalBalance").textContent = formatCurrency(0);
  document.getElementById("tokenList").innerHTML = "";
  updateTokenCount("0 tokens");
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  document.getElementById("emptyChart").style.display = "block";
}

// Network functions
async function ensureMonadNetwork() {
  try {
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    
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
    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting...";

    await ensureMonadNetwork();
    
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found");
    }

    account = accounts[0];
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();

    updateConnectedState();
    await loadPortfolio();

  } catch (error) {
    console.error("Connection error:", error);
    showError(error.message || "Failed to connect wallet");
    updateConnectedState();
  }
}

// Simplified portfolio loading - much faster
async function loadPortfolio() {
  try {
    showLoading(true);
    console.log('Loading portfolio...');
    
    // Wait for token metadata if needed
    if (Object.keys(tokenMetadata).length === 0) {
      await initTokenMetadata();
    }
    
    let totalUSD = 0;
    const tokenElements = [];
    const chartLabels = [];
    const chartValues = [];
    const chartColors = [];
    const tokenPricesForStorage = [];
    const tokenUSDValuesForStorage = [];
    let tokensWithBalance = 0;

    // Check only tokens that are likely to have value
    const priorityTokens = Object.entries(tokenMetadata)
      .filter(([addr, token]) => token.verified || token.usd > 0)
      .slice(0, 20); // Limit to first 20 priority tokens for speed

    console.log(`Checking ${priorityTokens.length} priority tokens...`);

    // Process tokens with minimal delays
    for (const [tokenAddress, token] of priorityTokens) {
      try {
        let formattedBalance = 0;
        
        if (tokenAddress === "0x0000000000000000000000000000000000000000") {
          // Native MON token
          const rawBalance = await provider.getBalance(account);
          formattedBalance = Number(ethers.utils.formatEther(rawBalance));
        } else {
          // ERC-20 token
          try {
            const tokenContract = new ethers.Contract(
              tokenAddress, 
              ["function balanceOf(address owner) view returns (uint256)"], 
              provider
            );
            const rawBalance = await tokenContract.balanceOf(account);
            formattedBalance = Number(ethers.utils.formatUnits(rawBalance, token.decimals));
          } catch (contractError) {
            // Skip invalid contracts
            continue;
          }
        }

        if (formattedBalance > 0) {
          tokensWithBalance++;
          const usdValue = formattedBalance * (token.usd || 0);
          
          if (usdValue >= 0.01) {
            totalUSD += usdValue;
            chartLabels.push(token.symbol);
            chartValues.push(usdValue);
            chartColors.push(generateColor(token.symbol));
          }

          tokenElements.push(createTokenElement(
            token, formattedBalance, usdValue, token.usd || 0, true, tokenAddress
          ));
          tokenPricesForStorage.push(token.usd || 0);
          tokenUSDValuesForStorage.push(usdValue);
        }

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.warn(`Error checking ${token.symbol}:`, error.message);
      }
    }

    console.log(`Portfolio loaded: ${tokensWithBalance} tokens, $${totalUSD.toFixed(2)}`);

    // Store original data for currency conversion
    originalPortfolioData = {
      totalUSD,
      tokenUSDValues: tokenUSDValuesForStorage,
      tokenPrices: tokenPricesForStorage,
      chartLabels,
      chartValues,
      chartColors
    };

    // Update UI
    updatePortfolioUI(totalUSD, tokensWithBalance, tokenElements, chartLabels, chartValues, chartColors);

  } catch (error) {
    console.error("Portfolio load error:", error);
    showError("Failed to load portfolio data");
  } finally {
    showLoading(false);
  }
}

function updatePortfolioUI(totalUSD, tokensWithBalance, tokenElements, chartLabels, chartValues, chartColors) {
  document.getElementById("totalBalance").textContent = formatCurrency(totalUSD);
  updateTokenCount(`${tokensWithBalance} tokens with balance`);
  document.getElementById("tokenList").innerHTML = tokenElements.join("");

  if (chartLabels.length > 0) {
    renderChart(chartLabels, chartValues, chartColors);
    document.getElementById("emptyChart").style.display = "none";
  } else {
    document.getElementById("emptyChart").style.display = "block";
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }
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
  if (!ctx) return;
  
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
            font: { size: 12, weight: '500' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(248, 250, 252, 0.1)',
          borderWidth: 1,
          cornerRadius: 8,
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