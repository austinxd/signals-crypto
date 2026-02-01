import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSubscriptionStatus } from '../services/api';

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

  const refresh = useCallback(async () => {
    try {
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
