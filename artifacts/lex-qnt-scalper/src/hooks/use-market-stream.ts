import { useCallback, useEffect, useRef, useState } from 'react';

export type BookLevel = { price: number; size: number; cumulativeSize: number };
export type BookState = {
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  updatedAt: number | null;
};
export type TickerState = {
  lastPrice: number | null;
  priceChangePercent: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  quoteVolume: number | null;
};
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

const EMPTY_BOOK: BookState = {
  bids: [],
  asks: [],
  bestBid: null,
  bestAsk: null,
  updatedAt: null,
};
const EMPTY_TICKER: TickerState = {
  lastPrice: null,
  priceChangePercent: null,
  highPrice: null,
  lowPrice: null,
  quoteVolume: null,
};
const STREAM_URL = 'wss://api.gateio.ws/ws/v4/';
const SNAPSHOT_URL =
  'https://api.gateio.ws/api/v4/spot/order_book?currency_pair=QNT_USDT&limit=20&with_id=true';

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function levelsFrom(payload: unknown, descending: boolean): BookLevel[] {
  if (!Array.isArray(payload)) return [];
  const parsed = payload
    .map((entry) => {
      if (!Array.isArray(entry)) return null;
      const price = asNumber(entry[0]);
      const size = asNumber(entry[1]);
      return price !== null && size !== null && size > 0 ? { price, size } : null;
    })
    .filter((level): level is { price: number; size: number } => level !== null)
    .sort((a, b) => (descending ? b.price - a.price : a.price - b.price));

  let cumulativeSize = 0;
  return parsed.map((level) => {
    cumulativeSize += level.size;
    return { ...level, cumulativeSize };
  });
}

export function useMarketStream(enabled: boolean) {
  const [book, setBook] = useState<BookState>(EMPTY_BOOK);
  const [ticker, setTicker] = useState<TickerState>(EMPTY_TICKER);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const retryCount = useRef(0);
  const reconnectNow = useCallback(() => {
    retryCount.current = 0;
    setRetryAttempt(0);
    setConnectionNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnection('disconnected');
      retryCount.current = 0;
      setRetryAttempt(0);
      return;
    }

    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let streamBookReceived = false;
    const snapshotAbort = new AbortController();

    fetch(SNAPSHOT_URL, { signal: snapshotAbort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
        return response.json() as Promise<Record<string, unknown>>;
      })
      .then((snapshot) => {
        if (disposed || streamBookReceived) return;
        const bids = levelsFrom(snapshot.bids, true);
        const asks = levelsFrom(snapshot.asks, false);
        if (bids.length || asks.length) {
          setBook({
            bids,
            asks,
            bestBid: bids[0]?.price ?? null,
            bestAsk: asks[0]?.price ?? null,
            updatedAt: Date.now(),
          });
          setLastUpdateAt(Date.now());
        }
      })
      .catch(() => {
        // Keep waiting for WebSocket snapshots if the public REST endpoint is unavailable.
      });

    const connect = () => {
      if (disposed) return;
      setConnection(retryCount.current === 0 ? 'connecting' : 'reconnecting');
      let currentSocket: WebSocket;
      try {
        currentSocket = new WebSocket(STREAM_URL);
        activeSocket = currentSocket;
      } catch {
        scheduleReconnect();
        return;
      }

      let watchdogTimer: number | null = null;
      let heartbeatTimer: number | null = null;
      const clearSocketTimers = () => {
        if (watchdogTimer !== null) {
          window.clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
      const armWatchdog = () => {
        if (watchdogTimer !== null) window.clearTimeout(watchdogTimer);
        watchdogTimer = window.setTimeout(() => currentSocket.close(), 45_000);
      };

      currentSocket.onmessage = (event) => {
        if (disposed || activeSocket !== currentSocket) return;
        try {
          const envelope = JSON.parse(String(event.data)) as {
            channel?: string;
            event?: string;
            result?: Record<string, unknown> | Array<Record<string, unknown>>;
          };
          if (envelope.channel === 'spot.pong') {
            armWatchdog();
            return;
          }
          if (envelope.event === 'error') {
            currentSocket.close();
            return;
          }
          if (envelope.event !== 'update') return;
          const receivedAt = Date.now();
          let consumed = false;

          if (envelope.channel === 'spot.order_book' && envelope.result && !Array.isArray(envelope.result)) {
            const bids = levelsFrom(envelope.result.bids, true);
            const asks = levelsFrom(envelope.result.asks, false);
            if (bids.length || asks.length) {
              streamBookReceived = true;
              setBook({
                bids,
                asks,
                bestBid: bids.length ? bids[0].price : null,
                bestAsk: asks.length ? asks[0].price : null,
                updatedAt: receivedAt,
              });
              consumed = true;
            }
          }

          if (envelope.channel === 'spot.tickers' && envelope.result) {
            const tickerRow = Array.isArray(envelope.result)
              ? envelope.result.find((row) => row.currency_pair === 'QNT_USDT')
              : envelope.result.currency_pair === 'QNT_USDT'
                ? envelope.result
                : undefined;
            const lastPrice = asNumber(tickerRow?.last);
            if (lastPrice !== null) {
              setTicker({
                lastPrice,
                priceChangePercent: asNumber(tickerRow?.change_percentage),
                highPrice: asNumber(tickerRow?.high_24h),
                lowPrice: asNumber(tickerRow?.low_24h),
                quoteVolume: asNumber(tickerRow?.quote_volume),
              });
              consumed = true;
            }
          }

          if (consumed) {
            setLastUpdateAt(receivedAt);
            setConnection('live');
            retryCount.current = 0;
            setRetryAttempt(0);
            armWatchdog();
          }
        } catch {
          // Ignore malformed frames; the socket remains eligible to recover on its next packet.
        }
      };

      currentSocket.onopen = () => {
        if (disposed || activeSocket !== currentSocket) return;
        armWatchdog();
        heartbeatTimer = window.setInterval(() => {
          if (currentSocket.readyState === WebSocket.OPEN) {
            currentSocket.send(
              JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'spot.ping' }),
            );
          }
        }, 25_000);
        const time = Math.floor(Date.now() / 1000);
        currentSocket.send(
          JSON.stringify({
            time,
            channel: 'spot.order_book',
            event: 'subscribe',
            payload: ['QNT_USDT', '20', '100ms'],
          }),
        );
        currentSocket.send(
          JSON.stringify({
            time,
            channel: 'spot.tickers',
            event: 'subscribe',
            payload: ['QNT_USDT'],
          }),
        );
      };
      currentSocket.onerror = () => {
        currentSocket.close();
      };
      currentSocket.onclose = () => {
        clearSocketTimers();
        if (activeSocket === currentSocket) activeSocket = null;
        if (!disposed) scheduleReconnect();
      };
    };

    function scheduleReconnect() {
      if (disposed || retryTimer !== null) return;
      setConnection('reconnecting');
      const attempt = retryCount.current;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000);
      retryCount.current += 1;
      setRetryAttempt(retryCount.current);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    }

    connect();
    return () => {
      disposed = true;
      snapshotAbort.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      activeSocket?.close();
      activeSocket = null;
    };
  }, [enabled, connectionNonce]);

  return { book, ticker, connection, lastUpdateAt, retryAttempt, reconnectNow };
}