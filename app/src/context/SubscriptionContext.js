import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSubscriptionStatus } from '../services/api';
import {
  initPurchases,
  checkSubscriptionStatus as checkStoreSubscription,
  syncSubscriptionWithBackend,
  addPurchaseListener,
} from '../services/purchases';

const SubscriptionContext = createContext();

export function SubscriptionProvider({ children }) {
  const [subscription, setSubscription] = useState({
    status: 'free',
    isPremium: false,
    aiUsage: 0,
    aiLimit: 5,
    aiRemaining: 5,
    expiresAt: null,
    loading: true,
  });

  // Initialize RevenueCat when component mounts
  useEffect(() => {
    const init = async () => {
      try {
        // Get user ID from stored token
        const token = await AsyncStorage.getItem('access_token');
        if (token) {
          // Decode user ID from token (simple extraction)
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.sub) {
              await initPurchases(payload.sub);
            }
          } catch (e) {
            console.log('Could not decode token for RevenueCat init');
          }
        }
      } catch (err) {
        console.log('Error initializing purchases:', err);
      }
    };

    init();
  }, []);

  // Set up listener for subscription changes from app store
  useEffect(() => {
    const removeListener = addPurchaseListener(async ({ isPremium }) => {
      // Sync with backend
      const token = await AsyncStorage.getItem('access_token');
      if (token) {
        await syncSubscriptionWithBackend(token);
      }
      // Refresh subscription state
      refresh();
    });

    return () => {
      if (removeListener) removeListener();
    };
  }, [refresh]);

  const refresh = useCallback(async () => {
    try {
      // Also check RevenueCat status and sync if needed
      const token = await AsyncStorage.getItem('access_token');
      if (token) {
        try {
          const storeStatus = await checkStoreSubscription();
          if (storeStatus.isPremium) {
            await syncSubscriptionWithBackend(token);
          }
        } catch (e) {
          // RevenueCat might not be available, continue with backend check
        }
      }

      // Get status from backend (source of truth)
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
      console.log('Error fetching subscription:', err);
      setSubscription(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
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
    // Return default values if used outside provider
    return {
      status: 'free',
      isPremium: false,
      aiUsage: 0,
      aiLimit: 5,
      aiRemaining: 5,
      expiresAt: null,
      loading: true,
      refresh: () => {},
    };
  }
  return context;
};

export default SubscriptionContext;
