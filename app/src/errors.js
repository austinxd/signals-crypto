// The server answers in English and sometimes with raw technical text. Nothing of that should reach the screen:
// every error shown to the user goes through friendlyError().

const GENERIC = 'No se pudo completar. Inténtalo de nuevo.';

// [pattern in the server text, Spanish sentence]
const KNOWN = [
  [/invalid email or password/i, 'Correo o contraseña incorrectos.'],
  [/already registered/i, 'Ya existe una cuenta con ese correo. Inicia sesión.'],
  [/at least 6 characters/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/invalid email|valid email|value is not a valid email/i, 'Ese correo no parece válido. Revísalo.'],
  [/ai limit|limit reached/i, 'Ya usaste todas tus consultas a la IA de este mes.'],
  [/admin account required/i, 'Solo el dueño del bot puede hacer esto.'],
  [/no binance|binance keys not/i, 'Primero conecta tu cuenta de Binance.'],
  [/invalid push token/i, 'Este teléfono no pudo registrarse para recibir avisos.'],
];

const BY_CONTEXT = {
  auth: 'No se pudo entrar. Inténtalo de nuevo.',
  binance: 'Binance rechazó las claves. Revisa que estén bien copiadas y que tengan permiso de lectura de Futuros.',
  store: 'La suscripción aún no está disponible en este dispositivo.',
  push: 'No se pudo completar. Revisa tu conexión e inténtalo de nuevo.',
};

/**
 * A sentence the user can read for any error. `context` picks the fallback: 'auth' | 'binance' | 'store' | 'push'.
 */
export function friendlyError(err, context) {
  if (err && (err.network || err.timeout || err.authFailed)) return err.message; // already written for the user
  const raw = String((err && (err.detail || err.message)) || '');
  for (const [pattern, text] of KNOWN) {
    if (pattern.test(raw)) return text;
  }
  const status = err && err.status;
  if (status === 429) return 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.';
  if (status >= 500) return 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.';
  if (context === 'auth' && status === 422) return 'Revisa el correo y la contraseña (mínimo 6 caracteres).';
  return BY_CONTEXT[context] || GENERIC;
}

/** "Connected. Balance: 12.00 USDT" -> "Conexión correcta. Saldo en futuros: 12,00 USDT." */
export function binanceOkText(message) {
  const m = /balance:\s*([\d.]+)/i.exec(String(message || ''));
  if (!m) return 'Conexión correcta.';
  return `Conexión correcta. Saldo en futuros: ${Number(m[1]).toFixed(2).replace('.', ',')} USDT.`;
}
