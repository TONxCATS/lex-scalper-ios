import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/* =========================================================
   TYPES
   ========================================================= */

export type CandleInterval =
  | '1m'
  | '5m'
  | '15m'
  | '1h'
  | '4h'
  | '1d';

export type MarketCandle = {
  time: number;

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
  quoteVolume: number;
};

/* =========================================================
   GATE.IO
   ========================================================= */

const GATE_API =
  'https://api.gateio.ws/api/v4';

const MAX_CANDLES = 300;

/*
 * Наші назви таймфреймів -> Gate.io interval.
 */
const GATE_INTERVALS: Record<
  CandleInterval,
  string
> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/* =========================================================
   HELPERS
   ========================================================= */

function toNumber(
  value: unknown,
): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

/*
 * Gate REST candle format:
 *
 * [
 *   timestamp,
 *   quoteVolume,
 *   close,
 *   high,
 *   low,
 *   open,
 *   baseVolume
 * ]
 */
function parseGateCandle(
  row: unknown,
): MarketCandle | null {
  if (!Array.isArray(row)) {
    return null;
  }

  if (row.length < 7) {
    return null;
  }

  const timestamp =
    toNumber(row[0]);

  const quoteVolume =
    toNumber(row[1]);

  const close =
    toNumber(row[2]);

  const high =
    toNumber(row[3]);

  const low =
    toNumber(row[4]);

  const open =
    toNumber(row[5]);

  const volume =
    toNumber(row[6]);

  if (
    timestamp === null ||
    quoteVolume === null ||
    close === null ||
    high === null ||
    low === null ||
    open === null ||
    volume === null
  ) {
    return null;
  }

  return {
    /*
     * Зберігаємо UNIX timestamp у секундах.
     * Це зручно для chart library.
     */
    time: Math.floor(timestamp),

    open,
    high,
    low,
    close,

    volume,
    quoteVolume,
  };
}

/* =========================================================
   NORMALIZE
   ========================================================= */

function normalizeCandles(
  rows: unknown[],
) {
  const candles =
    rows
      .map(parseGateCandle)
      .filter(
        (
          candle,
        ): candle is MarketCandle =>
          candle !== null,
      );

  /*
   * Gate може повернути newest -> oldest.
   * Графіку потрібно oldest -> newest.
   */
  candles.sort(
    (a, b) =>
      a.time - b.time,
  );

  /*
   * Прибираємо можливі дублікати.
   */
  const unique =
    new Map<
      number,
      MarketCandle
    >();

  for (const candle of candles) {
    unique.set(
      candle.time,
      candle,
    );
  }

  return Array.from(
    unique.values(),
  );
}

/* =========================================================
   HOOK
   ========================================================= */

export function useMarketCandles(
  pair: string,
  interval: CandleInterval,
  enabled = true,
) {
  const [candles, setCandles] =
    useState<MarketCandle[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [lastUpdateAt, setLastUpdateAt] =
    useState<number | null>(null);

  const abortRef =
    useRef<AbortController | null>(
      null,
    );

  const requestIdRef =
    useRef(0);

  const gateInterval =
    GATE_INTERVALS[interval];

  /* =======================================================
     LOAD
     ======================================================= */

  const loadCandles =
    useCallback(async () => {
      if (!enabled || !pair) {
        return;
      }

      /*
       * Скасовуємо попередній запит,
       * якщо користувач швидко змінив
       * монету або таймфрейм.
       */
      abortRef.current?.abort();

      const controller =
        new AbortController();

      abortRef.current =
        controller;

      const requestId =
        ++requestIdRef.current;

      setLoading(true);
      setError(null);

      try {
        const params =
          new URLSearchParams({
            currency_pair:
              pair,

            interval:
              gateInterval,

            limit:
              String(
                MAX_CANDLES,
              ),
          });

        const response =
          await fetch(
            `${GATE_API}/spot/candlesticks?${params.toString()}`,
            {
              method: 'GET',

              signal:
                controller.signal,

              headers: {
                Accept:
                  'application/json',
              },
            },
          );

        if (!response.ok) {
          throw new Error(
            `Gate.io candles: HTTP ${response.status}`,
          );
        }

        const payload:
          unknown =
          await response.json();

        if (
          requestId !==
          requestIdRef.current
        ) {
          return;
        }

        if (
          !Array.isArray(payload)
        ) {
          throw new Error(
            'Invalid Gate.io candle response',
          );
        }

        const nextCandles =
          normalizeCandles(
            payload,
          );

        if (
          nextCandles.length ===
          0
        ) {
          throw new Error(
            'No candle data returned',
          );
        }

        setCandles(
          nextCandles,
        );

        setLastUpdateAt(
          Date.now(),
        );
      } catch (caught) {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        const message =
          caught instanceof Error
            ? caught.message
            : 'Unable to load candles';

        setError(message);
      } finally {
        if (
          requestId ===
          requestIdRef.current
        ) {
          setLoading(false);
        }
      }
    }, [
      enabled,
      pair,
      gateInterval,
    ]);

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();

      setLoading(false);

      return;
    }

    /*
     * При зміні монети/TF старі свічки
     * прибираємо, щоб не показати
     * дані іншого ринку.
     */
    setCandles([]);
    setError(null);

    void loadCandles();

    return () => {
      abortRef.current?.abort();
    };
  }, [
    enabled,
    pair,
    interval,
    loadCandles,
  ]);

  /* =======================================================
     LIVE REFRESH
     ======================================================= */

  useEffect(() => {
    if (!enabled) {
      return;
    }

    /*
     * Поки робимо надійний REST refresh.
     *
     * Стакан у нас уже працює live окремо.
     * Далі можемо перевести свічки
     * на WebSocket без зміни UI.
     */
    const timer =
      window.setInterval(
        () => {
          void loadCandles();
        },
        5000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    enabled,
    loadCandles,
  ]);

  /* =======================================================
     DERIVED VALUES
     ======================================================= */

  const latestCandle =
    candles.length > 0
      ? candles[
          candles.length - 1
        ]
      : null;

  const previousCandle =
    candles.length > 1
      ? candles[
          candles.length - 2
        ]
      : null;

  const priceChange =
    latestCandle &&
    previousCandle &&
    previousCandle.close !== 0
      ? ((latestCandle.close -
          previousCandle.close) /
          previousCandle.close) *
        100
      : null;

  const highestPrice =
    useMemo(() => {
      if (
        candles.length === 0
      ) {
        return null;
      }

      return Math.max(
        ...candles.map(
          (candle) =>
            candle.high,
        ),
      );
    }, [candles]);

  const lowestPrice =
    useMemo(() => {
      if (
        candles.length === 0
      ) {
        return null;
      }

      return Math.min(
        ...candles.map(
          (candle) =>
            candle.low,
        ),
      );
    }, [candles]);

  /* =======================================================
     RETURN
     ======================================================= */

  return {
    candles,

    latestCandle,
    previousCandle,

    priceChange,

    highestPrice,
    lowestPrice,

    loading,
    error,

    lastUpdateAt,

    reload:
      loadCandles,
  };
}