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
const openOceanAPI = "https://open-api.openocean.finance/v4/monad/tokenList";
const nadFunMarketAPI = (addr) => `https://testnet-bot-api-server.nad.fun/token/market/${addr}`;
const nadFunListAPI = "/api/nad-tokens"; // Using my own API endpoint

let provider, signer, account;
let chartInstance;
let exchangeRates = { USD: 1 };
let currentCurrency = 'USD';
let originalPortfolioData = null;
let tokenMetadata = {};
let monUsdPrice = 0;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  // Check if ethers is loaded
  if (typeof ethers === 'undefined') {
    console.error('Ethers.js not loaded!');
    showError('Failed to load required libraries. Please refresh the page.');
    return;
  }
  
  document.getElementById("connectBtn").addEventListener("click", connectWallet);
  document.getElementById("currencySelect").addEventListener("change", handleCurrencyChange);
  
  // Load exchange rates and token metadata
  loadExchangeRates();
  initTokenMetadata();
  
  // Check if already connected
  if (window.ethereum && window.ethereum.selectedAddress) {
    autoConnect();
  }
});

// Handle account changes
if (window.ethereum) {
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

// Fetch tokens from OpenOcean API (your original implementation)
async function fetchOpenOceanTokens() {
  try {
    console.log('Fetching from OpenOcean API...');
    const res = await fetch(openOceanAPI);
    const data = await res.json();
    
    if (data.code === 200 && Array.isArray(data.data)) {
      data.data.forEach((t) => {
        tokenMetadata[t.address.toLowerCase()] = {
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          logo: t.icon,
          usd: parseFloat(t.usd),
          verified: true,
          source: 'openocean'
        };
        if (t.symbol === "MON") monUsdPrice = parseFloat(t.usd);
      });
      console.log('OpenOcean tokens loaded:', data.data.length);
    }
  } catch (error) {
    console.warn('Failed to fetch OpenOcean tokens:', error);
  }
}

// Fetch tokens from nad.fun API (with CORS handling)
async function fetchNadFunTokens() {
  try {
    console.log('Attempting to fetch from nad.fun API...');
    console.log('Note: This may fail due to CORS policy or maintenance');
    
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
          addedCount++;
        } catch (tokenError) {
          console.warn('Error processing nad.fun token:', tokenError);
        }
      });
      console.log(`nad.fun tokens loaded: ${addedCount} tokens`);
    }
  } catch (error) {
    console.warn('Failed to fetch nad.fun tokens - this is expected due to CORS restrictions or maintenance:', error.message);
    console.log('To access nad.fun data, you would need:');
    console.log('1. A backend proxy server, or');
    console.log('2. A CORS browser extension, or'); 
    console.log('3. Wait for nad.fun maintenance to complete');
  }
}

// Fetch tokens from swap.bean.exchange API
async function fetchSwapBeanTokens() {
  console.log('SwapBean API removed - endpoints do not exist');
  // This API doesn't actually exist, removing to prevent errors
}

// Fetch tokens from kuru.io API  
async function fetchKuruTokens() {
  console.log('Kuru API removed - endpoints do not exist');
  // This API doesn't actually exist, removing to prevent errors
}

// Get token USD value from metadata (your original helper function)
function getTokenUsdValue(address, balanceRaw, decimals) {
  const meta = tokenMetadata[address.toLowerCase()];
  if (!meta) return { value: 0, price: 0 };
  
  const balance = balanceRaw / (10 ** (meta.decimals || decimals || 18));
  const usdValue = balance * (meta.usd || 0);
  
  return { value: usdValue, price: meta.usd || 0 };
}

// Initialize all token metadata
async function initTokenMetadata() {
  console.log('Initializing token metadata from multiple sources...');
  
  try {
    // Show loading indicator
    const tokenCount = document.getElementById("tokenCount");
    const originalText = tokenCount.textContent;
    tokenCount.textContent = "Loading token data...";
    
    // Load OpenOcean first to get MON price
    await fetchOpenOceanTokens();
    
    if (!monUsdPrice) {
      console.warn("MON price not found from OpenOcean, some nad.fun conversions may fail.");
      monUsdPrice = 0.01; // Fallback price
    }
    
    // Try to load nad.fun (may fail due to CORS)
    await fetchNadFunTokens();
    
    const totalTokens = Object.keys(tokenMetadata).length;
    console.log(`Token metadata initialization complete: ${totalTokens} tokens loaded`);
    
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
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
  
  setTimeout(() => {
    errorDiv.style.display = "none";
  }, 5000);
}

function showLoading(show) {
  document.getElementById("loadingMessage").style.display = show ? "block" : "none";
}

function updateConnectedState() {
  const connectBtn = document.getElementById("connectBtn");
  const networkInfo = document.getElementById("networkInfo");
  
  if (account) {
    connectBtn.textContent = account.slice(0, 6) + "..." + account.slice(-4);
    connectBtn.disabled = false;
    networkInfo.style.display = "inline-block";
  } else {
    connectBtn.textContent = "Connect Wallet";
    connectBtn.disabled = false;
    networkInfo.style.display = "none";
  }
}

function resetApp() {
  account = null;
  provider = null;
  signer = null;
  originalPortfolioData = null;
  
  updateConnectedState();
  document.getElementById("totalBalance").textContent = formatCurrency(0);
  document.getElementById("tokenList").innerHTML = "";
  document.getElementById("tokenCount").textContent = "0 tokens";
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  document.getElementById("emptyChart").style.display = "block";
}

// Network functions
async function ensureMonadNetwork() {
  try {
    const currentChainId = await ethereum.request({ method: 'eth_chainId' });
    console.log("Current chain ID:", currentChainId);
    
    if (currentChainId !== MONAD_PARAMS.chainId) {
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: MONAD_PARAMS.chainId }]
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await ethereum.request({
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
    const accounts = await ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      account = accounts[0];
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      
      updateConnectedState();
      
      const chainId = await ethereum.request({ method: 'eth_chainId' });
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

    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
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

// Portfolio functions - Updated to only show tokens with balance
async function loadPortfolio() {
  try {
    showLoading(true);
    console.log("Loading portfolio for account:", account);
    
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

    // Get all token addresses from metadata
    const tokenAddresses = Object.keys(tokenMetadata);
    console.log(`Checking ${tokenAddresses.length} tokens for balances...`);

    for (const tokenAddress of tokenAddresses) {
      const token = tokenMetadata[tokenAddress];
      let formattedBalance = 0;
      let tokenPrice = token.usd || 0;
      
      try {
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

        // Only process tokens with non-zero balance
        if (formattedBalance > 0) {
          tokensWithBalance++;
          
          // Try to get better price if current price is 0
          if (tokenPrice === 0) {
            tokenPrice = await getBestTokenPrice(tokenAddress, formattedBalance);
            console.log(`Updated price for ${token.symbol}: $${tokenPrice}`);
          }
          
          const usdValue = formattedBalance * tokenPrice;
          
          if (usdValue >= 0.01) { // Only include in chart if value >= $0.01
            totalUSD += usdValue;
            chartLabels.push(token.symbol);
            chartValues.push(usdValue);
            chartColors.push(generateColor(token.symbol));
          }

          // Create token element for display
          tokenElements.push(createTokenElement(token, formattedBalance, usdValue, tokenPrice, true, tokenAddress));
          tokenPricesForStorage.push(tokenPrice);
          tokenUSDValuesForStorage.push(usdValue);
          
          console.log(`${token.symbol}: Balance ${formattedBalance}, Price $${tokenPrice}, Value $${usdValue.toFixed(2)}`);
        }

      } catch (tokenError) {
        console.warn(`Error checking balance for ${token.symbol}:`, tokenError.message);
      }
    }

    console.log(`Portfolio loaded: ${tokensWithBalance} tokens with balance, Total USD: $${totalUSD.toFixed(2)}`);

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
    document.getElementById("totalBalance").textContent = formatCurrency(totalUSD);
    document.getElementById("tokenCount").textContent = `${tokensWithBalance} tokens with balance`;
    document.getElementById("tokenList").innerHTML = tokenElements.join("");

    // Update chart
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

  } catch (error) {
    console.error("Portfolio load error:", error);
    showError(error.message || "Failed to load portfolio data");
  } finally {
    showLoading(false);
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
  const ctx = document.getElementById("portfolioChart").getContext("2d");
  
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  chartInstance = new Chart(ctx, {
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