import React, { useState, useEffect, useCallback } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getPositions } from '../services/api';
import PositionCard from '../components/PositionCard';
import LockedPositionCard from '../components/LockedPositionCard';
import { useSubscription } from '../context/SubscriptionContext';
import { Screen, Card, Stat, StatRow, Notice, Empty, Loading, Button } from '../components/ui';
import { space, type, fmtSigned, pnlColor } from '../theme';

const PositionsScreen = () => {
  const navigation = useNavigation();
  const { isPremium } = useSubscription();
  const [positions, setPositions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [totalPnl, setTotalPnl] = useState(0);
  const [mode, setMode] = useState(null);
  const [hasKeys, setHasKeys] = useState(null); // null = the server did not say

  const fetchPositions = useCallback(async () => {
    try {
      setError(null);
      const data = await getPositions();
      const pos = data.positions || [];
      setPositions(pos);
      setMode(data.mode || null);
      setHasKeys(typeof data.has_binance_keys === 'boolean' ? data.has_binance_keys : null);
      const pnl = pos.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
      setTotalPnl(pnl);
    } catch (err) {
      if (err.status === 401) {
        setError('Inicia sesión para ver tus posiciones.');
      } else {
        setError('No se pudieron cargar tus posiciones. Revisa tu conexión.');
      }
      console.error('Positions error:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPositions();
    }, [fetchPositions])
  );

  useEffect(() => {
    const interval = setInterval(fetchPositions, 15000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPositions();
    setRefreshing(false);
  }, [fetchPositions]);

  const count = positions.length;

  const body = () => {
    if (error) {
      return (
        <Notice tone="danger" title="Algo falló">
          <Text style={type.bodyDim}>{error}</Text>
          <Button label="Reintentar" kind="secondary" small onPress={onRefresh} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
        </Notice>
      );
    }
    if (!loaded) return <Loading label="Leyendo tus posiciones…" />;
    if (count === 0) {
      if (hasKeys === true) {
        return (
          <Empty
            title="No tienes operaciones abiertas en Binance"
            hint="Tu cuenta está conectada. Cuando abras una operación de futuros en Binance aparecerá aquí, con su riesgo y sus avisos. Las operaciones del bot no salen aquí: están en la pestaña Bot."
          />
        );
      }
      return (
        <Empty
          title="Conecta tu cuenta de Binance"
          hint="Aquí verás las operaciones de futuros que tengas abiertas en Binance: cómo van, dónde se cierran solas y si siguen teniendo sentido. Para eso la app necesita tus claves de Binance; se añaden en Ajustes."
          actionLabel="Ir a Ajustes"
          onAction={() => navigation?.navigate?.('Settings')}
        />
      );
    }
    return (
      <>
        <Card>
          <StatRow>
            <Stat label="Posiciones abiertas" value={String(count)} hint="En Binance, dinero real" />
            <Stat
              label="Resultado ahora"
              value={`${fmtSigned(totalPnl)} USDT`}
              color={pnlColor(totalPnl)}
              hint="Sin cerrar: cambia con el precio"
            />
          </StatRow>
        </Card>

        {positions.map((pos, index) => {
          // Free plan: only the first position is shown, the rest are locked
          const isLocked = !isPremium && index > 0;

          if (isLocked) {
            return (
              <LockedPositionCard
                key={pos.id || pos.symbol}
                onPress={() => navigation.navigate('Upgrade')}
              />
            );
          }

          return (
            <PositionCard
              key={pos.id || pos.symbol}
              position={{ ...pos, mode }}
              totalCount={count}
            />
          );
        })}
      </>
    );
  };

  return (
    <Screen
      title="Posiciones"
      subtitle="Tus operaciones en Binance, con tu dinero real. Las del bot no salen aquí."
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {body()}
    </Screen>
  );
};

export default PositionsScreen;
