import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getApiUrl } from './api';

// RevenueCat API Keys - Try multiple ways to access config for different Expo versions
const getExtraConfig = () => {
  // Try expoConfig first (newer Expo SDK)
  if (Constants.expoConfig?.extra) {
    return Constants.expoConfig.extra;
  }
  // Try manifest2 (EAS builds)
  if (Constants.manifest2?.extra?.expoClient?.extra) {
    return Constants.manifest2.extra.expoClient.extra;
  }
  // Try manifest (older Expo SDK / Expo Go)
  if (Constants.manifest?.extra) {
    return Constants.manifest.extra;
  }
  return {};
};

const extraConfig = getExtraConfig();
const REVENUECAT_IOS_KEY = extraConfig.revenueCatIosKey || '';
const REVENUECAT_ANDROID_KEY = extraConfig.revenueCatAndroidKey || '';

// Log for debugging
console.log('[Purchases] Extra config:', JSON.stringify(extraConfig));
console.log('[Purchases] iOS Key loaded:', REVENUECAT_IOS_KEY ? 'Yes (' + REVENUECAT_IOS_KEY.substring(0, 10) + '...)' : 'No');

// Product identifiers (must match what you create in App Store Connect / Google Play Console)
export const PRODUCT_IDS = {
  PREMIUM_MONTHLY: 'premium_monthly',
};

// Entitlement identifier (must match what you create in RevenueCat)
export const ENTITLEMENTS = {
  PREMIUM: 'premium',
};

let isConfigured = false;
let configurePromise = null;

/**
 * Initialize RevenueCat SDK
 * Call this once when the app starts, after user is authenticated
 */
export async function initPurchases(userId) {
  if (isConfigured) return true;

  // If already configuring, wait for that to complete
  if (configurePromise) {
    return configurePromise;
  }

  configurePromise = (async () => {
    try {
      const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;

      // Check if API key is configured
      if (!apiKey || apiKey.length === 0) {
        console.log('[Purchases] RevenueCat API key not configured - set in app.json extra');
        return false;
      }

      Purchases.configure({ apiKey });

      // Identify user with their backend user ID
      if (userId) {
        await Purchases.logIn(String(userId));
      }

      isConfigured = true;
      console.log('[Purchases] RevenueCat configured successfully');
      return true;
    } catch (err) {
      console.error('[Purchases] Error configuring RevenueCat:', err);
      return false;
    }
  })();

  return configurePromise;
}

/**
 * Ensure RevenueCat is configured before making calls
 */
async function ensureConfigured() {
  if (isConfigured) return true;
  if (configurePromise) {
    return configurePromise;
  }
  // Try to configure without user ID
  return initPurchases(null);
}

/**
 * Get available packages (products) for purchase
 */
export async function getOfferings() {
  try {
    // Ensure RevenueCat is configured first
    console.log('[Purchases] getOfferings called, checking configuration...');
    const configured = await ensureConfigured();
    if (!configured) {
      console.log('[Purchases] Cannot get offerings - not configured');
      throw new Error('RevenueCat no está configurado. Verifica la API key.');
    }

    console.log('[Purchases] Fetching offerings from RevenueCat...');
    const offerings = await Purchases.getOfferings();
    console.log('[Purchases] Offerings response:', JSON.stringify({
      hasOfferings: !!offerings,
      hasCurrent: !!offerings?.current,
      currentId: offerings?.current?.identifier,
      packagesCount: offerings?.current?.availablePackages?.length || 0,
    }));

    if (offerings.current) {
      const packages = offerings.current.availablePackages;
      console.log('[Purchases] Available packages:', packages.map(p => p.identifier));
      return packages;
    }

    console.log('[Purchases] No current offering found');
    return [];
  } catch (err) {
    console.error('[Purchases] Error getting offerings:', err);
    throw err; // Re-throw so UpgradeScreen can show the error
  }
}

/**
 * Purchase a package
 * @param {object} pkg - Package object from getOfferings()
 */
export async function purchasePackage(pkg) {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return {
      success: true,
      customerInfo,
      isPremium: checkPremiumEntitlement(customerInfo),
    };
  } catch (err) {
    if (err.userCancelled) {
      return { success: false, cancelled: true };
    }
    console.error('[Purchases] Error purchasing:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Restore previous purchases
 */
export async function restorePurchases() {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return {
      success: true,
      customerInfo,
      isPremium: checkPremiumEntitlement(customerInfo),
    };
  } catch (err) {
    console.error('[Purchases] Error restoring purchases:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check if user has premium entitlement
 */
export async function checkSubscriptionStatus() {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return {
      isPremium: checkPremiumEntitlement(customerInfo),
      customerInfo,
    };
  } catch (err) {
    console.error('[Purchases] Error checking subscription:', err);
    return { isPremium: false };
  }
}

/**
 * Helper to check premium entitlement from customerInfo
 */
function checkPremiumEntitlement(customerInfo) {
  if (!customerInfo) return false;
  const entitlement = customerInfo.entitlements.active[ENTITLEMENTS.PREMIUM];
  return !!entitlement;
}

/**
 * Sync subscription status with backend
 */
export async function syncSubscriptionWithBackend(token) {
  try {
    const { isPremium, customerInfo } = await checkSubscriptionStatus();
    const apiUrl = await getApiUrl();

    // Send status to backend
    const response = await fetch(`${apiUrl}/api/account/sync-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        is_premium: isPremium,
        expires_at: customerInfo?.entitlements?.active?.[ENTITLEMENTS.PREMIUM]?.expirationDate || null,
        store: Platform.OS,
      }),
    });

    return response.ok;
  } catch (err) {
    console.error('[Purchases] Error syncing with backend:', err);
    return false;
  }
}

/**
 * Set up listener for subscription changes
 */
export function addPurchaseListener(callback) {
  return Purchases.addCustomerInfoUpdateListener((customerInfo) => {
    const isPremium = checkPremiumEntitlement(customerInfo);
    callback({ isPremium, customerInfo });
  });
}
