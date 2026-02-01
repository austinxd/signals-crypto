import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const API_URL_KEY = '@api_url';
const USER_PAIRS_KEY = '@user_pairs';
const USER_TIMEFRAME_KEY = '@user_timeframe';
const USER_TRADING_MODE_KEY = '@user_trading_mode';
const JWT_TOKEN_KEY = '@jwt_token';
const REFRESH_TOKEN_KEY = '@refresh_token';

// Default API URL (change this to your server's URL)
// Use your computer's local IP when testing on physical device
const DEFAULT_API_URL = 'https://api.criterio.trade';

/**
 * Get the API URL
 */
export async function getApiUrl() {
  // Always use default URL for now (uncomment below to use stored URL)
  return DEFAULT_API_URL;
  /*
  try {
    const url = await AsyncStorage.getItem(API_URL_KEY);
    return url || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
  */
}

/**
 * Set the API URL
 */
export async function setApiUrl(url) {
  try {
    await AsyncStorage.setItem(API_URL_KEY, url);
    return true;
  } catch {
    return false;
  }
}

/**
 * JWT token management
 */
export async function getJwtToken() {
  try {
    return await AsyncStorage.getItem(JWT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshTokenStored() {
  try {
    return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setTokens(accessToken, refreshToken) {
  try {
    await AsyncStorage.setItem(JWT_TOKEN_KEY, accessToken);
    if (refreshToken) {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  } catch {
    // ignore
  }
}

export async function clearTokens() {
  try {
    await AsyncStorage.multiRemove([JWT_TOKEN_KEY, REFRESH_TOKEN_KEY]);
  } catch {
    // ignore
  }
}

export async function isAuthenticated() {
  const token = await getJwtToken();
  return !!token;
}

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let refreshPromise = null;

// Callback for when auth fails completely (token can't be refreshed)
let onAuthFailedCallback = null;

export function setOnAuthFailed(callback) {
  onAuthFailedCallback = callback;
}

/**
 * Make API request with automatic token refresh on 401
 */
async function apiRequest(endpoint, options = {}, isRetry = false) {
  const baseUrl = await getApiUrl();
  const url = `${baseUrl}${endpoint}`;

  console.log('Fetching:', url);

  // Inject JWT auth header if available
  const token = await getJwtToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      timeout: 10000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle 401 - try to refresh token (but not for auth endpoints)
      if (response.status === 401 && !isRetry && !endpoint.includes('/api/auth/')) {
        console.log('Token expired, attempting refresh...');

        try {
          // Prevent multiple simultaneous refresh attempts
          if (!isRefreshing) {
            isRefreshing = true;
            refreshPromise = tryRefreshToken();
          }

          await refreshPromise;
          isRefreshing = false;

          // Retry the original request with new token
          return apiRequest(endpoint, options, true);
        } catch (refreshError) {
          isRefreshing = false;
          console.log('Token refresh failed, auth required');
          await clearTokens();
          if (onAuthFailedCallback) {
            onAuthFailedCallback();
          }
          const err = new Error('Session expired. Please login again.');
          err.status = 401;
          err.authFailed = true;
          throw err;
        }
      }

      const err = new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    console.log('Response OK from:', endpoint);
    return data;
  } catch (error) {
    console.error(`API Error (${url}):`, error.message);
    throw error;
  }
}

async function tryRefreshToken() {
  const rt = await getRefreshTokenStored();
  if (!rt) throw new Error('No refresh token');

  const baseUrl = await getApiUrl();
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });

  if (!response.ok) {
    throw new Error('Refresh failed');
  }

  const data = await response.json();
  await setTokens(data.access_token, data.refresh_token);
  console.log('Token refreshed successfully');
  return data;
}

/**
 * Get server status
 */
export async function getServerStatus() {
  return apiRequest('/');
}

/**
 * Get server configuration (available pairs, timeframes)
 */
export async function getConfig() {
  return apiRequest('/api/config');
}

/**
 * Get market data for all pairs
 */
export async function getMarketData(timeframe = null, refresh = false) {
  const tf = timeframe || (await getUserTimeframe());
  return apiRequest(`/api/market?timeframe=${tf}&refresh=${refresh}`);
}

/**
 * Get market data for a specific pair
 */
export async function getPairData(pair, timeframe = null) {
  const pairFormatted = pair.replace('/', '-');
  const tf = timeframe || (await getUserTimeframe());
  return apiRequest(`/api/market/${pairFormatted}?timeframe=${tf}`);
}

/**
 * Get unified market data (4H context + 15m timing) per pair
 */
export async function getUnifiedMarketData(pairs = null, refresh = false) {
  let url = `/api/market-unified?refresh=${refresh}`;
  if (pairs && pairs.length > 0) {
    url += `&pairs=${encodeURIComponent(pairs.join(','))}`;
  }
  return apiRequest(url);
}

/**
 * Get volume profile and CVD for a pair
 * Returns executed volume by price level (no signals, context only)
 */
export async function getVolumeProfile(pair, timeframe = '15m') {
  const pairFormatted = pair.replace('/', '-').replace(':USDT', '');
  return apiRequest(`/api/volume-profile/${pairFormatted}?timeframe=${timeframe}`);
}

/**
 * Get AI explanation of market context for a pair
 * Returns descriptive text about current market state (no signals, no predictions)
 */
export async function getAIExplanation(pair) {
  const pairFormatted = pair.replace('/', '-').replace(':USDT', '');
  return apiRequest(`/api/ai-explanation/${pairFormatted}`);
}

/**
 * Get recent signals (filtered by user subscriptions if token provided)
 */
export async function getSignals(limit = 20, timeframe = null, token = null) {
  let url = `/api/signals?limit=${limit}`;
  if (timeframe) {
    url += `&timeframe=${timeframe}`;
  }
  if (token) {
    url += `&token=${encodeURIComponent(token)}`;
  }
  return apiRequest(url);
}

/**
 * Get available trading pairs
 */
export async function getAvailablePairs() {
  return apiRequest('/api/available-pairs');
}

/**
 * Get available timeframes
 */
export async function getAvailableTimeframes() {
  return apiRequest('/api/available-timeframes');
}

/**
 * Register push token with the server
 */
export async function registerPushToken(token, pairs = null, timeframe = null, tradingMode = null) {
  const userPairs = pairs || (await getUserPairs());
  const userTimeframe = timeframe || (await getUserTimeframe());
  const userTradingMode = tradingMode || (await getUserTradingMode());

  return apiRequest('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      token,
      pairs: userPairs,
      timeframe: userTimeframe,
      trading_mode: userTradingMode,
    }),
  });
}

/**
 * Unregister push token
 */
export async function unregisterPushToken(token) {
  return apiRequest('/api/unregister', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Update notification preferences
 */
export async function updatePreferences(token, pairs, timeframe, tradingMode = null) {
  return apiRequest('/api/preferences', {
    method: 'POST',
    body: JSON.stringify({
      token,
      pairs,
      timeframe,
      trading_mode: tradingMode,
    }),
  });
}

/**
 * Get user settings from server
 */
export async function getUserSettingsFromServer(token) {
  return apiRequest('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Send test notification
 */
export async function sendTestNotification(token) {
  return apiRequest('/api/test-notification', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Get user's selected pairs from local storage
 */
export async function getUserPairs() {
  try {
    const pairs = await AsyncStorage.getItem(USER_PAIRS_KEY);
    return pairs ? JSON.parse(pairs) : ['BTC/USDT', 'ETH/USDT'];
  } catch {
    return ['BTC/USDT', 'ETH/USDT'];
  }
}

/**
 * Save user's selected pairs to local storage
 */
export async function setUserPairs(pairs) {
  try {
    await AsyncStorage.setItem(USER_PAIRS_KEY, JSON.stringify(pairs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get user's selected timeframe from local storage
 */
export async function getUserTimeframe() {
  try {
    const timeframe = await AsyncStorage.getItem(USER_TIMEFRAME_KEY);
    return timeframe || '4h';
  } catch {
    return '4h';
  }
}

/**
 * Save user's selected timeframe to local storage
 */
export async function setUserTimeframe(timeframe) {
  try {
    await AsyncStorage.setItem(USER_TIMEFRAME_KEY, timeframe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get user's trading mode from local storage
 */
export async function getUserTradingMode() {
  try {
    const mode = await AsyncStorage.getItem(USER_TRADING_MODE_KEY);
    return mode || 'balanced';
  } catch {
    return 'balanced';
  }
}

/**
 * Save user's trading mode to local storage
 */
export async function setUserTradingMode(mode) {
  try {
    await AsyncStorage.setItem(USER_TRADING_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a new subscription (JWT authenticated)
 */
export async function addSubscription(pair) {
  return apiRequest('/api/subscriptions/add', {
    method: 'POST',
    body: JSON.stringify({ pair }),
  });
}

/**
 * Remove a subscription (JWT authenticated)
 */
export async function removeSubscription(subscriptionId) {
  return apiRequest('/api/subscriptions/remove', {
    method: 'POST',
    body: JSON.stringify({ subscription_id: subscriptionId }),
  });
}

/**
 * Get all subscriptions for the user (JWT authenticated)
 */
export async function getSubscriptions() {
  return apiRequest('/api/subscriptions');
}

/**
 * Get notification history from server
 */
export async function getNotificationHistoryFromServer(token, limit = 50) {
  return apiRequest('/api/notifications/history', {
    method: 'POST',
    body: JSON.stringify({ token, limit }),
  });
}

/**
 * Clear signals for user (hides signals before current time)
 */
export async function clearSignals(token) {
  return apiRequest('/api/signals/clear', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Clear notifications for user (hides notifications before current time)
 */
export async function clearNotifications(token) {
  return apiRequest('/api/notifications/clear', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

// ============================================================
// Auth endpoints
// ============================================================

export async function register(email, password) {
  const data = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(email, password) {
  const data = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function refreshAccessToken() {
  const rt = await getRefreshTokenStored();
  if (!rt) throw new Error('No refresh token');
  const data = await apiRequest('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: rt }),
  });
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function logout() {
  await clearTokens();
}

// ============================================================
// Account endpoints
// ============================================================

export async function getProfile() {
  return apiRequest('/api/account/profile');
}

export async function updateBinanceKeys(apiKey, apiSecret) {
  return apiRequest('/api/account/binance-keys', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
  });
}

export async function verifyBinanceKeys() {
  return apiRequest('/api/account/verify-binance', { method: 'POST' });
}

export async function deleteBinanceKeys() {
  return apiRequest('/api/account/binance-keys', { method: 'DELETE' });
}

export async function updateAccountSettings(settings) {
  return apiRequest('/api/account/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

// ============================================================
// Position & Exit Alert endpoints
// ============================================================

export async function getPositions() {
  return apiRequest('/api/positions');
}

export async function getPositionAlerts(symbol) {
  const s = symbol.replace('/', '-');
  return apiRequest(`/api/positions/${s}/alerts`);
}

export async function getPositionAIAnalysis(symbol) {
  const s = symbol.replace('/', '-').replace(':USDT', '');
  return apiRequest(`/api/positions/${s}/ai-analysis`);
}

export async function getExitAlerts(limit = 50) {
  return apiRequest(`/api/exit-alerts?limit=${limit}`);
}

// ============================================================
// Notifications (Bell) endpoints
// ============================================================

export async function getNotifications(limit = 50, unreadOnly = false) {
  return apiRequest(`/api/notifications?limit=${limit}&unread_only=${unreadOnly}`);
}

export async function getUnreadCount() {
  return apiRequest('/api/notifications/unread-count');
}

export async function markNotificationRead(notificationId) {
  return apiRequest(`/api/notifications/${notificationId}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return apiRequest('/api/notifications/read-all', { method: 'POST' });
}

// ============================================================
// Subscription endpoints
// ============================================================

export async function getSubscriptionStatus() {
  return apiRequest('/api/account/subscription');
}
