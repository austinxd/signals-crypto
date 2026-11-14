import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { register, login } from '../services/api';
import { Button, Notice, Segment } from '../components/ui';
import { colors, space, radius, type } from '../theme';
import { friendlyError } from '../errors';

// Set the first time anyone logs in on this phone. Until then the screen opens on "Crear cuenta".
const HAD_SESSION_KEY = '@had_session';

const AuthScreen = ({ onAuthSuccess, notice }) => {
  const insets = useSafeAreaInsets();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(HAD_SESSION_KEY)
      .then((had) => {
        if (had !== '1') setIsLogin(false); // new phone: most likely a new user
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Escribe tu correo y tu contraseña.');
      return;
    }
    if (!isLogin && password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (isLogin) {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
      AsyncStorage.setItem(HAD_SESSION_KEY, '1').catch(() => {});
      onAuthSuccess();
    } catch (err) {
      setError(friendlyError(err, 'auth'));
    } finally {
      setLoading(false);
    }
  };

  const setMode = (key) => {
    setIsLogin(key === 'login');
    setError(null);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.brandName}>Criterio</Text>
          <Text style={[type.bodyDim, { textAlign: 'center', marginTop: space.sm }]}>
            Futuros de cripto, explicados claro.
          </Text>
          <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>
            Mercado: análisis de cuándo abrir long o short · Mi Binance: tus futuros con dinero real · Bot: práctica
            con dinero simulado.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={{ marginBottom: space.lg }}>
            <Segment
              options={[{ key: 'login', label: 'Entrar' }, { key: 'signup', label: 'Crear cuenta' }]}
              value={isLogin ? 'login' : 'signup'}
              onChange={setMode}
              disabled={loading}
            />
          </View>

          {!!notice && !error && <Notice tone="warn">{notice}</Notice>}
          {!!error && <Notice tone="danger">{error}</Notice>}

          <Text style={styles.fieldLabel}>Correo electrónico</Text>
          <TextInput
            style={styles.input}
            placeholder="tu@correo.com"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>Contraseña</Text>
          <TextInput
            style={styles.input}
            placeholder={isLogin ? 'Tu contraseña' : 'Mínimo 6 caracteres'}
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />

          <Button
            label={isLogin ? 'Entrar' : 'Crear cuenta'}
            onPress={handleSubmit}
            loading={loading}
            style={{ marginTop: space.sm }}
          />

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  brand: { alignItems: 'center', marginBottom: space.xxl },
  brandName: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  form: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  fieldLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: space.md, marginBottom: space.lg,
  },
});

export default AuthScreen;
