# Crypto Signals - Sistema de Trading con Notificaciones Push

Sistema automatizado que analiza BTC/USDT y ETH/USDT en Binance, detecta señales de trading usando indicadores técnicos (EMA + RSI + MACD + Volumen), y envía notificaciones push a una app iOS/Android.

## Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Binance API   │────▶│  Backend Python  │────▶│  Expo Push API  │
│   (REST)        │     │  (FastAPI)       │     │                 │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                        │
                                 │ REST API               │
                                 ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │   App Expo/RN   │◀────│   Push Notif    │
                        │   (iOS/Android) │     │                 │
                        └─────────────────┘     └─────────────────┘
```

## Estrategia de Trading

### Señal LONG
- Precio > EMA 200
- RSI(14) < 40 y subiendo
- MACD línea cruza sobre señal (cruce alcista)
- Volumen > promedio 20 períodos

### Señal SHORT
- Precio < EMA 200
- RSI(14) > 60 y bajando
- MACD línea cruza bajo señal (cruce bajista)
- Volumen > promedio 20 períodos

### Risk Management
- **Stop Loss**: 1.5% desde entrada (o 1.5x ATR)
- **Take Profit**: 3% desde entrada (o 3x ATR)
- **Risk/Reward**: 1:2

## Estructura del Proyecto

```
/cripto
├── backend/
│   ├── main.py              # Entry point con FastAPI
│   ├── config.py            # Configuración
│   ├── binance_client.py    # Cliente Binance (CCXT)
│   ├── indicators.py        # Indicadores técnicos
│   ├── signals.py           # Lógica de señales
│   ├── notifications.py     # Push notifications
│   ├── requirements.txt     # Dependencias Python
│   └── .env.example         # Variables de entorno
├── app/
│   ├── App.js               # Entry point
│   ├── app.json             # Configuración Expo
│   ├── package.json         # Dependencias Node
│   └── src/
│       ├── screens/
│       │   ├── HomeScreen.js     # Pantalla principal
│       │   └── SettingsScreen.js # Configuración
│       ├── services/
│       │   ├── api.js            # Cliente API
│       │   └── notifications.js  # Push notifications
│       └── components/
│           ├── SignalCard.js     # Card de señal
│           └── PairCard.js       # Card de par
└── README.md
```

## Instalación

### Backend

```bash
cd backend

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
# o: venv\Scripts\activate  # Windows

# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu configuración

# Ejecutar
python main.py
```

El backend estará disponible en `http://localhost:8000`

### App Expo

```bash
cd app

# Instalar dependencias
npm install

# Ejecutar
npx expo start
```

Escanea el QR con Expo Go (iOS/Android) para probar la app.

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/api/market` | Datos de mercado de todos los pares |
| GET | `/api/market/{pair}` | Datos de un par específico |
| GET | `/api/signals` | Señales recientes |
| GET | `/api/available-pairs` | Pares disponibles |
| POST | `/api/register` | Registrar push token |
| POST | `/api/unregister` | Eliminar push token |
| POST | `/api/preferences` | Actualizar preferencias |
| POST | `/api/test-notification` | Enviar notificación de prueba |

## Configuración

### Backend (config.py)

```python
# Pares a monitorear
TRADING_PAIRS = ["BTC/USDT", "ETH/USDT"]

# Timeframe
TIMEFRAME = "4h"

# Indicadores
EMA_PERIOD = 200
RSI_PERIOD = 14
RSI_OVERSOLD = 40
RSI_OVERBOUGHT = 60

# Risk Management
STOP_LOSS_PERCENT = 1.5
TAKE_PROFIT_PERCENT = 3.0

# Polling
POLL_INTERVAL = 300  # 5 minutos
```

### App

En la pantalla de Ajustes puedes:
- Cambiar la URL del servidor
- Seleccionar qué pares monitorear
- Activar/desactivar notificaciones
- Enviar notificación de prueba

## Formato de Notificación

```json
{
  "title": "🟢 LONG BTC/USDT",
  "body": "Entrada: $98,500 | TP: $101,455 | SL: $97,022",
  "data": {
    "pair": "BTC/USDT",
    "side": "LONG",
    "entry": 98500,
    "takeProfit": 101455,
    "stopLoss": 97022,
    "timestamp": "2024-01-21T15:00:00Z",
    "indicators": {
      "rsi": 38.5,
      "macd": 0.0012,
      "ema_200": 97000
    }
  }
}
```

## Despliegue en Producción

### Backend (Railway/Render/VPS)

1. Configura las variables de entorno
2. Asegúrate de que el puerto 8000 esté expuesto
3. El backend se ejecuta con `uvicorn main:app --host 0.0.0.0 --port 8000`

### App (EAS Build)

```bash
# Instalar EAS CLI
npm install -g eas-cli

# Login en Expo
eas login

# Configurar build
eas build:configure

# Build para iOS
eas build --platform ios

# Build para Android
eas build --platform android
```

## Notas Importantes

- El backend no requiere API keys de Binance para datos públicos
- Las notificaciones push requieren un dispositivo físico
- El análisis usa timeframe 4H para menos ruido
- Hay un cooldown de 4 horas entre señales del mismo par
- Los datos de mercado se actualizan cada 5 minutos

## Disclaimer

Este sistema es solo para fines educativos. El trading de criptomonedas conlleva riesgos significativos. No inviertas más de lo que puedas permitirte perder. Las señales generadas no constituyen asesoramiento financiero.
