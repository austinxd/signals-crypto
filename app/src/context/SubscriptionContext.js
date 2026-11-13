import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSubscriptionStatus, getJwtToken, getAccountId } from '../services/api';
import {
  initPurchases,
  checkSubscriptionStatus as checkStoreSubscription,
  syncSubscriptionWithBackend,
  addPurchaseListener,
} from '../services/purchases';

const SubscriptionContext = createContext();

const DEFAULTS = {
  status: 'free',
  isPremium: false,
  aiUsage: 0,
  aiLimit: 5,
  aiRemaining: 5,
  expiresAt: null,
  loading: true,
};

/** Mounted only while a user is logged in (see App.js), so mounting = "someone just logged in". */
export function SubscriptionProvider({ children }) {
  const [subscription, setSubscription] = useState(DEFAULTS);

  const refresh = useCallback(async () => {
    try {
      // If the store says Premium, tell the server before asking it for the account status
      const token = await getJwtToken();
      if (token) {
        try {
          const storeStatus = await checkStoreSubscription();
          if (storeStatus.isPremium) {
            await syncSubscriptionWithBackend(token);
          }
        } catch (e) {
          // the store may be unavailable; the server answer below still works
        }
      }

      // The server is the source of truth
      const data = await getSubscriptionStatus();
      setSubscription({
        status: data.status || 'free',
        isPremium: data.is_premium || false,
        aiUsage: data.ai_usage || 0,
        aiLimit: data.ai_limit || 5,
        aiRemaining: data.ai_remaining || 0,
        expiresAt: data.expires_at || null,
        loading: false,
      });
    } catch (err) {
      console.log('Error fetching subscription:', err && err.message);
      setSubscription((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  // Identify this account in the store, then load its status. Without the identification a purchase is
  // anonymous and never reaches the account.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const accountId = await getAccountId();
        if (accountId) {
          // Do not let a slow store hold up the account status
          await Promise.race([initPurchases(accountId), new Promise((resolve) => setTimeout(resolve, 8000))]);
        }
      } catch (err) {
        console.log('Error initializing purchases:', err && err.message);
      }
      if (alive) refresh();
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // The store tells us when the subscription changes (purchase, renewal, expiry)
  useEffect(() => {
    let removeListener = null;
    try {
      removeListener = addPurchaseListener(async () => {
        const token = await getJwtToken();
        if (token) {
          await syncSubscriptionWithBackend(token);
        }
        refresh();
      });
    } catch (err) {
      console.log('Could not listen to the store:', err && err.message);
    }
    return () => {
      if (typeof removeListener === 'function') removeListener();
    };
  }, [refresh]);

  return (
    <SubscriptionContext.Provider value={{ ...subscription, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    // Used outside the provider: behave as a free account that is still loading
    return { ...DEFAULTS, refresh: () => {} };
  }
  return context;
};

export default SubscriptionContext;
