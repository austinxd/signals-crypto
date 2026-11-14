import React, { useState, useEffect, useCallback } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getPositions } from '../services/api';
import PositionCard from '../components/PositionCard';
import LockedPositionCard from '../components/LockedPositionCard';
import { useSubscription } from '../context/SubscriptionContext';
import { Screen, Card, Stat, StatRow, Notice, Empty, Loading, Button, Help } from '../components/ui';
import { colors, space, type, fmtSigned, pnlColor } from '../theme';

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
        setError('Inicia sesión para ver tus operaciones.');
      } else {
        setError('No se pudieron cargar tus operaciones. Revisa tu conexión.');
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
  const noStop = positions.filter((p) => !(Number(p.current_stop_loss ?? p.stop_loss) > 0)).length;

  const scope = (
    <Help label="¿Qué aparece aquí?" style={{ marginBottom: space.md }}>
      Solo tus operaciones de futuros en Binance (USDT-M), con tu dinero real. Las monedas que tengas compradas en tu
      billetera spot, en Earn o en Funding no aparecen aquí ni se analizan. Las operaciones del bot son simuladas y
      están en la pestaña Bot.
    </Help>
  );

  const body = () => {
    if (error) {
      return (
        <Notice tone="danger" title="Algo falló">
          <Text style={type.bodyDim}>{error}</Text>
          <Button label="Reintentar" kind="secondary" small onPress={onRefresh} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
        </Notice>
      );
    }
    if (!loaded) return <Loading label="Leyendo tus futuros en Binance…" />;
    if (count === 0) {
      if (hasKeys === true) {
        return (
          <Empty
            title="No tienes futuros abiertos en Binance"
            hint="Tu cuenta está conectada. Cuando abras un long o un short en Binance Futuros aparecerá aquí. Las monedas de tu billetera spot no aparecen: la app solo lee futuros."
          />
        );
      }
      return (
        <Empty
          title="Conecta tu cuenta de Binance"
          hint="Verás tus operaciones de futuros con dinero real: cuánto ganan o pierden, dónde se cierran solas y si siguen teniendo sentido. No se lee tu billetera spot. Las claves se añaden en Ajustes."
          actionLabel="Ir a Ajustes"
          onAction={() => navigation?.navigate?.('Settings')}
        />
      );
    }
    return (
      <>
        <Card>
          <StatRow>
            <Stat
              label={count === 1 ? 'Resultado de tu operación' : `Resultado de tus ${count} operaciones`}
              value={`${fmtSigned(totalPnl)} USDT`}
              color={pnlColor(totalPnl)}
              hint="Dinero real, aún sin cerrar"
            />
            <Stat
              label="Sin cierre automático (stop)"
              value={String(noStop)}
              color={noStop > 0 ? colors.danger : colors.accent}
              hint={noStop > 0 ? 'Nada limita su pérdida' : 'Todas tienen stop'}
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
      title="Mi Binance"
      subtitle="Tus futuros abiertos"
      money="real"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loaded && !error && scope}
      {body()}
    </Screen>
  );
};

export default PositionsScreen;
