import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/* =========================================================
   LEX — GATE.IO CANDLES
   Real public OHLCV feed
   ========================================================= */

/* =========================================================
   TYPES
   ========================================================= */

export type GateTimeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d';

export type GateCandle = {
  /*
   * Unix timestamp in milliseconds.
   */
  timestamp: number;

  open: number;
  high: number;
  low: number;
  close: number;

  /*
   * Base asset volume.
   */
  volume: number;

  /*
   * Quote asset volume.
   */
  quoteVolume: number | null;
};

/* =========================================================
   HOOK RESULT
   ========================================================= */

export type UseGateCandlesResult = {
  candles: GateCandle[];

  loading: boolean;

  error: string | null;

  reload: () => void;

  lastLoadedAt: number | null;
};

/* =========================================================
   API
   ========================================================= */

const GATE_API_BASE =
  'https://api.gateio.ws/api/v4';

const DEFAULT_LIMIT = 500;

const MAX_LIMIT = 1000;

/* =========================================================
   AUTO REFRESH

   REST candles are refreshed periodically.
   The latest candle therefore keeps updating even if
   the user does not change timeframe.

   This is intentionally not ultra-fast because the
   order book WebSocket remains the source for LEX
   microstructure / scalping analysis.
   ========================================================= */

const REFRESH_INTERVAL_MS = 10_000;

/* =========================================================
   TIMEFRAME MAP
   ========================================================= */

const GATE_INTERVALS: Record<
  GateTimeframe,
  string
> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/* =========================================================
   HELPERS
   ========================================================= */

function normalizePair(
  pair: string,
): string {
  return pair
    .trim()
    .toUpperCase()
    .replace(/\//g, '_')
    .replace(/-/g, '_')
    .replace(/\s+/g, '');
}

function toFiniteNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const numeric =
    typeof value === 'number'
      ? value
      : Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : null;
}

/* =========================================================
   TIMESTAMP NORMALIZATION
   ========================================================= */

function normalizeTimestampMs(
  value: number,
): number {
  /*
   * Gate REST timestamps are normally seconds.
   *
   * Example:
   * 1760000000
   *
   * Internally LEX stores milliseconds:
   *
   * 1760000000000
   */

  if (
    value <
    10_000_000_000
  ) {
    return Math.floor(
      value * 1000,
    );
  }

  return Math.floor(
    value,
  );
}

/* =========================================================
   RAW GATE CANDLE
   ========================================================= */

type RawGateCandle =
  | unknown[]
  | Record<
      string,
      unknown
    >;

/* =========================================================
   ARRAY PARSER
   ========================================================= */

function parseArrayCandle(
  row: unknown[],
): GateCandle | null {
  /*
   * Gate.io Spot API v4:
   *
   * [
   *   timestamp,
   *   quote_volume,
   *   close,
   *   high,
   *   low,
   *   open,
   *   base_volume,
   *   ...
   * ]
   */

  if (
    row.length < 6
  ) {
    return null;
  }

  const rawTimestamp =
    toFiniteNumber(
      row[0],
    );

  const quoteVolume =
    toFiniteNumber(
      row[1],
    );

  const close =
    toFiniteNumber(
      row[2],
    );

  const high =
    toFiniteNumber(
      row[3],
    );

  const low =
    toFiniteNumber(
      row[4],
    );

  const open =
    toFiniteNumber(
      row[5],
    );

  const rawBaseVolume =
    toFiniteNumber(
      row[6],
    );

  if (
    rawTimestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  if (
    rawTimestamp <= 0 ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return null;
  }

  if (
    high < low
  ) {
    return null;
  }

  /*
   * Gate normally provides base volume.
   *
   * Defensive fallback:
   * quote volume / close ≈ base volume.
   */

  const calculatedVolume =
    rawBaseVolume ??
    (
      quoteVolume !== null &&
      close > 0
        ? quoteVolume /
          close
        : 0
    );

  if (
    !Number.isFinite(
      calculatedVolume,
    ) ||
    calculatedVolume < 0
  ) {
    return null;
  }

  return {
    timestamp:
      normalizeTimestampMs(
        rawTimestamp,
      ),

    open,
    high,
    low,
    close,

    volume:
      calculatedVolume,

    quoteVolume,
  };
}

/* =========================================================
   OBJECT PARSER
   ========================================================= */

function parseObjectCandle(
  row: Record<
    string,
    unknown
  >,
): GateCandle | null {
  const rawTimestamp =
    toFiniteNumber(
      row.timestamp ??
        row.time ??
        row.t,
    );

  const open =
    toFiniteNumber(
      row.open ??
        row.o,
    );

  const high =
    toFiniteNumber(
      row.high ??
        row.h,
    );

  const low =
    toFiniteNumber(
      row.low ??
        row.l,
    );

  const close =
    toFiniteNumber(
      row.close ??
        row.c,
    );

  const quoteVolume =
    toFiniteNumber(
      row.quoteVolume ??
        row.quote_volume ??
        row.quoteVol ??
        row.q,
    );

  const rawBaseVolume =
    toFiniteNumber(
      row.volume ??
        row.baseVolume ??
        row.base_volume ??
        row.baseVol ??
        row.v,
    );

  if (
    rawTimestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  if (
    rawTimestamp <= 0 ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return null;
  }

  if (
    high < low
  ) {
    return null;
  }

  const calculatedVolume =
    rawBaseVolume ??
    (
      quoteVolume !== null &&
      close > 0
        ? quoteVolume /
          close
        : 0
    );

  if (
    !Number.isFinite(
      calculatedVolume,
    ) ||
    calculatedVolume < 0
  ) {
    return null;
  }

  return {
    timestamp:
      normalizeTimestampMs(
        rawTimestamp,
      ),

    open,
    high,
    low,
    close,

    volume:
      calculatedVolume,

    quoteVolume,
  };
}

/* =========================================================
   PARSE SINGLE CANDLE
   ========================================================= */

function parseGateCandle(
  row: RawGateCandle,
): GateCandle | null {
  if (
    Array.isArray(row)
  ) {
    return parseArrayCandle(
      row,
    );
  }

  if (
    row !== null &&
    typeof row ===
      'object'
  ) {
    return parseObjectCandle(
      row,
    );
  }

  return null;
}

/* =========================================================
   VALIDATE CANDLE
   ========================================================= */

function isValidCandle(
  candle: GateCandle,
): boolean {
  if (
    !Number.isFinite(
      candle.timestamp,
    ) ||
    !Number.isFinite(
      candle.open,
    ) ||
    !Number.isFinite(
      candle.high,
    ) ||
    !Number.isFinite(
      candle.low,
    ) ||
    !Number.isFinite(
      candle.close,
    ) ||
    !Number.isFinite(
      candle.volume,
    )
  ) {
    return false;
  }

  if (
    candle.timestamp <= 0 ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.volume < 0
  ) {
    return false;
  }

  if (
    candle.high <
    candle.low
  ) {
    return false;
  }

  /*
   * OHLC sanity checks.
   */

  if (
    candle.high <
      candle.open ||
    candle.high <
      candle.close
  ) {
    return false;
  }

  if (
    candle.low >
      candle.open ||
    candle.low >
      candle.close
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   DEDUPE + SORT
   ========================================================= */

function dedupeCandles(
  candles: GateCandle[],
): GateCandle[] {
  const map =
    new Map<
      number,
      GateCandle
    >();

  for (
    const candle of candles
  ) {
    if (
      !isValidCandle(
        candle,
      )
    ) {
      continue;
    }

    /*
     * Latest occurrence wins.
     * Useful for current candle updates.
     */

    map.set(
      candle.timestamp,
      candle,
    );
  }

  return Array.from(
    map.values(),
  ).sort(
    (a, b) =>
      a.timestamp -
      b.timestamp,
  );
}

/* =========================================================
   MERGE OLD + NEW

   This lets periodic refresh update the currently open
   candle without destroying the already loaded history.
   ========================================================= */

function mergeCandles(
  current: GateCandle[],
  incoming: GateCandle[],
): GateCandle[] {
  const map =
    new Map<
      number,
      GateCandle
    >();

  for (
    const candle of current
  ) {
    map.set(
      candle.timestamp,
      candle,
    );
  }

  for (
    const candle of incoming
  ) {
    map.set(
      candle.timestamp,
      candle,
    );
  }

  return Array.from(
    map.values(),
  )
    .filter(
      isValidCandle,
    )
    .sort(
      (a, b) =>
        a.timestamp -
        b.timestamp,
    );
}

/* =========================================================
   ERROR MESSAGE
   ========================================================= */

async function buildGateError(
  response: Response,
): Promise<string> {
  let message =
    `Gate.io candle request failed (${response.status})`;

  try {
    const payload:
      unknown =
      await response.json();

    if (
      payload &&
      typeof payload ===
        'object'
    ) {
      const object =
        payload as Record<
          string,
          unknown
        >;

      const detail =
        object.message ??
        object.label ??
        object.detail;

      if (
        typeof detail ===
          'string' &&
        detail.trim()
      ) {
        message =
          `${message}: ${detail}`;
      }
    }
  } catch {
    /*
     * Response body may not
     * contain JSON.
     */
  }

  return message;
}

/* =========================================================
   FETCH GATE CANDLES
   ========================================================= */

async function fetchGateCandles({
  pair,
  timeframe,
  limit,
  signal,
}: {
  pair: string;

  timeframe:
    GateTimeframe;

  limit: number;

  signal:
    AbortSignal;
}): Promise<
  GateCandle[]
> {
  const normalizedPair =
    normalizePair(
      pair,
    );

  const interval =
    GATE_INTERVALS[
      timeframe
    ];

  if (!interval) {
    throw new Error(
      `Unsupported timeframe: ${timeframe}`,
    );
  }

  const safeLimit =
    Math.max(
      1,
      Math.min(
        MAX_LIMIT,
        Math.floor(
          limit,
        ),
      ),
    );

  const params =
    new URLSearchParams();

  params.set(
    'currency_pair',
    normalizedPair,
  );

  params.set(
    'interval',
    interval,
  );

  params.set(
    'limit',
    String(
      safeLimit,
    ),
  );

  const url =
    `${GATE_API_BASE}/spot/candlesticks?${params.toString()}`;

  const response =
    await fetch(
      url,
      {
        method:
          'GET',

        signal,

        cache:
          'no-store',

        headers: {
          Accept:
            'application/json',
        },
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await buildGateError(
        response,
      ),
    );
  }

  const payload:
    unknown =
    await response.json();

  if (
    !Array.isArray(
      payload,
    )
  ) {
    throw new Error(
      'Gate.io returned an invalid candle response.',
    );
  }

  const parsed:
    GateCandle[] = [];

  for (
    const rawRow of payload
  ) {
    const candle =
      parseGateCandle(
        rawRow as RawGateCandle,
      );

    if (
      candle &&
      isValidCandle(
        candle,
      )
    ) {
      parsed.push(
        candle,
      );
    }
  }

  const result =
    dedupeCandles(
      parsed,
    );

  if (
    result.length === 0
  ) {
    throw new Error(
      `Gate.io returned no valid ${timeframe} candles for ${normalizedPair}.`,
    );
  }

  return result;
}

/* =========================================================
   HOOK
   ========================================================= */

export function useGateCandles(
  pair: string,

  timeframe:
    GateTimeframe,

  enabled = true,

  limit =
    DEFAULT_LIMIT,
): UseGateCandlesResult {
  const [
    candles,
    setCandles,
  ] = useState<
    GateCandle[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(
    false,
  );

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    lastLoadedAt,
    setLastLoadedAt,
  ] = useState<
    number | null
  >(null);

  const [
    reloadToken,
    setReloadToken,
  ] = useState(
    0,
  );

  const requestIdRef =
    useRef(
      0,
    );

  const mountedRef =
    useRef(
      true,
    );

  /*
   * Used so automatic refresh does not
   * show the full loading state every
   * ten seconds.
   */

  const hasLoadedRef =
    useRef(
      false,
    );

  /* =======================================================
     COMPONENT LIFETIME
     ======================================================= */

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;
    };
  }, []);

  /* =======================================================
     MANUAL RELOAD
     ======================================================= */

  const reload =
    useCallback(
      () => {
        setReloadToken(
          (
            current,
          ) =>
            current + 1,
        );
      },
      [],
    );

  /* =======================================================
     RESET WHEN PAIR / TIMEFRAME CHANGES

     Important:
     when user taps 1m -> 5m -> 1h -> 4h,
     old candles must not remain visible as though they
     belonged to the newly selected timeframe.
     ======================================================= */

  useEffect(() => {
    setCandles(
      [],
    );

    setError(
      null,
    );

    setLastLoadedAt(
      null,
    );

    hasLoadedRef.current =
      false;
  }, [
    pair,
    timeframe,
  ]);

  /* =======================================================
     LOAD
     ======================================================= */

  useEffect(() => {
    if (
      !enabled
    ) {
      setLoading(
        false,
      );

      return;
    }

    const normalizedPair =
      normalizePair(
        pair,
      );

    if (
      !normalizedPair ||
      !normalizedPair.includes(
        '_',
      )
    ) {
      setCandles(
        [],
      );

      setError(
        'Invalid market pair.',
      );

      setLoading(
        false,
      );

      return;
    }

    const [
      baseAsset,
      quoteAsset,
    ] =
      normalizedPair.split(
        '_',
      );

    if (
      !baseAsset ||
      !quoteAsset
    ) {
      setCandles(
        [],
      );

      setError(
        'Invalid market pair.',
      );

      setLoading(
        false,
      );

      return;
    }

    const controller =
      new AbortController();

    const requestId =
      ++requestIdRef.current;

    let active =
      true;

    /* =====================================================
       FETCH FUNCTION
       ===================================================== */

    const load =
      async (
        background:
          boolean,
      ) => {
        if (
          !background
        ) {
          setLoading(
            true,
          );
        }

        try {
          const result =
            await fetchGateCandles(
              {
                pair:
                  normalizedPair,

                timeframe,

                limit,

                signal:
                  controller.signal,
              },
            );

          if (
            controller.signal
              .aborted ||
            !active ||
            !mountedRef.current ||
            requestId !==
              requestIdRef.current
          ) {
            return;
          }

          /*
           * First load replaces data.
           *
           * Later automatic updates merge by timestamp,
           * replacing the still-open current candle.
           */

          if (
            hasLoadedRef.current
          ) {
            setCandles(
              (
                current,
              ) => {
                const merged =
                  mergeCandles(
                    current,
                    result,
                  );

                /*
                 * Do not let repeated refreshes
                 * grow memory indefinitely.
                 */

                return merged.slice(
                  -Math.max(
                    1,
                    Math.min(
                      MAX_LIMIT,
                      Math.floor(
                        limit,
                      ),
                    ),
                  ),
                );
              },
            );
          } else {
            setCandles(
              result,
            );

            hasLoadedRef.current =
              true;
          }

          setLastLoadedAt(
            Date.now(),
          );

          setError(
            null,
          );
        } catch (
          cause
        ) {
          if (
            controller.signal
              .aborted ||
            !active ||
            !mountedRef.current ||
            requestId !==
              requestIdRef.current
          ) {
            return;
          }

          const message =
            cause instanceof
            Error
              ? cause.message
              : 'Unable to load Gate.io candles.';

          setError(
            message,
          );
        } finally {
          if (
            !background &&
            active &&
            mountedRef.current &&
            requestId ===
              requestIdRef.current
          ) {
            setLoading(
              false,
            );
          }
        }
      };

    /* =====================================================
       INITIAL REQUEST
       ===================================================== */

    void load(
      false,
    );

    /* =====================================================
       AUTO REFRESH

       Keeps latest candle updated.
       ===================================================== */

    const intervalId =
      window.setInterval(
        () => {
          if (
            document.visibilityState ===
            'hidden'
          ) {
            return;
          }

          void load(
            true,
          );
        },

        REFRESH_INTERVAL_MS,
      );

    /* =====================================================
       REFRESH WHEN APP RETURNS TO FOREGROUND
       ===================================================== */

    const handleVisibilityChange =
      () => {
        if (
          document.visibilityState ===
          'visible'
        ) {
          void load(
            true,
          );
        }
      };

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );

    /* =====================================================
       CLEANUP
       ===================================================== */

    return () => {
      active =
        false;

      controller.abort();

      window.clearInterval(
        intervalId,
      );

      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      );
    };
  }, [
    enabled,
    limit,
    pair,
    reloadToken,
    timeframe,
  ]);

  /* =======================================================
     RESULT
     ======================================================= */

  return {
    candles,

    loading,

    error,

    reload,

    lastLoadedAt,
  };
}

/* =========================================================
   DEFAULT EXPORT
   ========================================================= */

export default useGateCandles;