import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';
import { getApiUrl } from './api';

// RevenueCat API Keys - Set these after creating your RevenueCat account
// https://app.revenuecat.com/
const REVENUECAT_IOS_KEY = 'appl_XXXXXXXXXXXXXXXXXXXXXXXXX'; // Replace with your iOS key
const REVENUECAT_ANDROID_KEY = 'goog_XXXXXXXXXXXXXXXXXXXXXXXXX'; // Replace with your Android key

// Product identifiers (must match what you create in App Store Connect / Google Play Console)
export const PRODUCT_IDS = {
  PREMIUM_MONTHLY: 'premium_monthly',
};

// Entitlement identifier (must match what you create in RevenueCat)
export const ENTITLEMENTS = {
  PREMIUM: 'premium',
};

let isConfigured = false;

/**
 * Initialize RevenueCat SDK
 * Call this once when the app starts, after user is authenticated
 */
export async function initPurchases(userId) {
  if (isConfigured) return;

  try {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;

    // Check if API key is configured
    if (apiKey.includes('XXXXX')) {
      console.log('[Purchases] RevenueCat API key not configured');
      return;
    }

    Purchases.configure({ apiKey });

    // Identify user with their backend user ID
    if (userId) {
      await Purchases.logIn(String(userId));
    }

    isConfigured = true;
    console.log('[Purchases] RevenueCat configured successfully');
  } catch (err) {
    console.error('[Purchases] Error configuring RevenueCat:', err);
  }
}

/**
 * Get available packages (products) for purchase
 */
export async function getOfferings() {
  try {
    const offerings = await Purchases.getOfferings();

    if (offerings.current) {
      return offerings.current.availablePackages;
    }

    return [];
  } catch (err) {
    console.error('[Purchases] Error getting offerings:', err);
    return [];
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
