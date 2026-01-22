import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const API_URL_KEY = '@api_url';
const USER_PAIRS_KEY = '@user_pairs';
const USER_TIMEFRAME_KEY = '@user_timeframe';

// Default API URL (change this to your server's URL)
// Use your computer's local IP when testing on physical device
const DEFAULT_API_URL = 'http://149.56.23.98:8050';

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
 * Make API request
 */
async function apiRequest(endpoint, options = {}) {
  const baseUrl = await getApiUrl();
  const url = `${baseUrl}${endpoint}`;

  console.log('Fetching:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: 10000,
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Response OK from:', endpoint);
    return data;
  } catch (error) {
    console.error(`API Error (${url}):`, error.message);
    throw error;
  }
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
 * Get recent signals
 */
export async function getSignals(limit = 20) {
  return apiRequest(`/api/signals?limit=${limit}`);
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
export async function registerPushToken(token, pairs = null, timeframe = null) {
  const userPairs = pairs || (await getUserPairs());
  const userTimeframe = timeframe || (await getUserTimeframe());

  return apiRequest('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      token,
      pairs: userPairs,
      timeframe: userTimeframe,
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
export async function updatePreferences(token, pairs, timeframe) {
  return apiRequest('/api/preferences', {
    method: 'POST',
    body: JSON.stringify({ token, pairs, timeframe }),
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
