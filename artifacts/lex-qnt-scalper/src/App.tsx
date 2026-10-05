import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  Activity,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';

import LexChart from '@/components/LexChart';
import LexOrderBook from '@/components/LexOrderBook';

import {
  useGateCandles,
  type GateTimeframe,
} from '@/hooks/use-gate-candles';

import {
  useGateOrderBook,
} from '@/hooks/use-gate-order-book';

/* =========================================================
   LEX V2.4.1 FINAL
   src/App.tsx

   DATA FLOW

   Gate.io candles
        ↓
   useGateCandles
        ↓
   LexChart

   Gate.io Level-2
        ↓
   useGateOrderBook
        ↓
   ┌──────────────────────────────┐
   │                              │
   ↓                              ↓
   LexOrderBook                 LexChart
   Ladder                      LEX Engine
   Level-2                     Heatmap
                               Heatmap History
                               Heatmap Analyzer

   IMPORTANT

   - Real Gate.io OHLCV
   - Real Gate.io Level-2
   - Real liquidity heatmap history
   - No synthetic/fake Level-2 data
   ========================================================= */

type Market = {
  base: string;
  quote: string;
};

/* =========================================================
   DEFAULTS
   ========================================================= */

const DEFAULT_MARKET: Market = {
  base: 'QNT',
  quote: 'USDT',
};

const DEFAULT_TIMEFRAME: GateTimeframe =
  '15m';

const QUICK_MARKETS = [
  'QNT',
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'DOGE',
  'ADA',
  'LINK',
  'AVAX',
  'SUI',
  'PEPE',
  'RENDER',
];

/* =========================================================
   MARKET HELPERS
   ========================================================= */

function normalizeAsset(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      '',
    );
}

function buildGatePair(
  market: Market,
): string {
  return `${market.base}_${market.quote}`;
}

/* =========================================================
   PRICE CHANGE
   ========================================================= */

function calculatePriceChangePercent(
  candles: {
    open: number;
    close: number;
  }[],
): number | null {
  if (
    candles.length === 0
  ) {
    return null;
  }

  const first =
    candles[0];

  const last =
    candles[
      candles.length - 1
    ];

  if (
    !first ||
    !last ||
    !Number.isFinite(
      first.open,
    ) ||
    !Number.isFinite(
      last.close,
    ) ||
    first.open === 0
  ) {
    return null;
  }

  return (
    (
      last.close -
      first.open
    ) /
    first.open
  ) * 100;
}

/* =========================================================
   PRICE FORMAT
   ========================================================= */

function formatPrice(
  value: number | null,
): string {
  if (
    value === null ||
    !Number.isFinite(
      value,
    )
  ) {
    return '—';
  }

  const digits =
    value >= 1000
      ? 2
      : value >= 100
        ? 3
        : value >= 1
          ? 4
          : value >= 0.01
            ? 6
            : 8;

  return value.toLocaleString(
    'en-US',
    {
      minimumFractionDigits:
        Math.min(
          2,
          digits,
        ),

      maximumFractionDigits:
        digits,
    },
  );
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  /* =======================================================
     MARKET STATE
     ======================================================= */

  const [
    market,
    setMarket,
  ] =
    useState<Market>(
      DEFAULT_MARKET,
    );

  const [
    marketInput,
    setMarketInput,
  ] =
    useState(
      DEFAULT_MARKET.base,
    );

  const [
    timeframe,
    setTimeframe,
  ] =
    useState<GateTimeframe>(
      DEFAULT_TIMEFRAME,
    );

  const [
    bookLimit,
    setBookLimit,
  ] =
    useState(200);

  /* =======================================================
     GATE.IO PAIR
     ======================================================= */

  const gatePair =
    useMemo(
      () =>
        buildGatePair(
          market,
        ),
      [market],
    );

  /* =======================================================
     REAL GATE.IO CANDLES
     ======================================================= */

  const {
    candles,

    loading:
      candlesLoading,

    error:
      candlesError,

    reload:
      reloadCandles,

    lastLoadedAt:
      candlesLastLoadedAt,
  } =
    useGateCandles(
      gatePair,
      timeframe,
      true,
      500,
    );

  /* =======================================================
     REAL GATE.IO LEVEL-2

     IMPORTANT:
     heatmap here is the historical Level-2 snapshot stream
     created by useGateOrderBook.

     This is NOT a synthetic heatmap.
     ======================================================= */

  const {
    bids,
    asks,

    lastPrice:
      orderBookPrice,

    metrics:
      orderBookMetrics,

    heatmap:
      orderBookHeatmap,

    connected:
      orderBookConnected,

    loading:
      orderBookLoading,

    error:
      orderBookError,

    lastUpdatedAt:
      orderBookLastUpdatedAt,

    reload:
      reloadOrderBook,
  } =
    useGateOrderBook(
      gatePair,
      {
        enabled: true,

        limit:
          bookLimit,

        updateInterval:
          '100ms',
      },
    );

  /* =======================================================
     CANDLE PRICE FALLBACK
     ======================================================= */

  const candlePrice =
    useMemo(() => {
      if (
        candles.length ===
        0
      ) {
        return null;
      }

      const last =
        candles[
          candles.length -
            1
        ];

      if (
        !last ||
        !Number.isFinite(
          last.close,
        )
      ) {
        return null;
      }

      return last.close;
    }, [candles]);

  /* =======================================================
     LIVE PRICE

     Prefer Level-2 midpoint.
     Fall back to latest candle.
     ======================================================= */

  const lastPrice =
    orderBookPrice ??
    candlePrice;

  /* =======================================================
     PRICE CHANGE
     ======================================================= */

  const priceChangePercent =
    useMemo(
      () =>
        calculatePriceChangePercent(
          candles,
        ),
      [candles],
    );

  /* =======================================================
     TIMEFRAME
     ======================================================= */

  const handleTimeframeChange =
    useCallback(
      (
        next:
          GateTimeframe,
      ) => {
        setTimeframe(
          next,
        );
      },
      [],
    );

  /* =======================================================
     MARKET CHANGE
     ======================================================= */

  const changeMarket =
    useCallback(
      (
        base: string,
        quote = 'USDT',
      ) => {
        const normalizedBase =
          normalizeAsset(
            base,
          );

        const normalizedQuote =
          normalizeAsset(
            quote,
          );

        if (
          !normalizedBase ||
          !normalizedQuote
        ) {
          return;
        }

        setMarket({
          base:
            normalizedBase,

          quote:
            normalizedQuote,
        });

        setMarketInput(
          normalizedBase,
        );
      },
      [],
    );

  /* =======================================================
     MARKET SEARCH
     ======================================================= */

  const handleMarketSubmit =
    useCallback(
      (
        event:
          React.FormEvent<HTMLFormElement>,
      ) => {
        event.preventDefault();

        const normalized =
          normalizeAsset(
            marketInput,
          );

        if (
          !normalized
        ) {
          return;
        }

        changeMarket(
          normalized,
          'USDT',
        );
      },
      [
        changeMarket,
        marketInput,
      ],
    );

  /* =======================================================
     RELOAD ALL
     ======================================================= */

  const reloadAll =
    useCallback(
      () => {
        reloadCandles();
        reloadOrderBook();
      },
      [
        reloadCandles,
        reloadOrderBook,
      ],
    );

  /* =======================================================
     STATUS
     ======================================================= */

  const marketLoading =
    candlesLoading ||
    orderBookLoading;

  const hasMarketError =
    Boolean(
      candlesError ||
      orderBookError,
    );

  const lastUpdate =
    Math.max(
      candlesLastLoadedAt ??
        0,

      orderBookLastUpdatedAt ??
        0,
    );

  /* =======================================================
     LEVEL-2 / HEATMAP STATUS
     ======================================================= */

  const heatmapSnapshots =
    orderBookHeatmap.length;

  const level2Live =
    orderBookConnected &&
    orderBookMetrics !==
      null;

  const heatmapLive =
    level2Live &&
    heatmapSnapshots > 0;

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <main className="lex-app">

      {/* ===================================================
          HEADER
          =================================================== */}

      <header className="lex-app-header">
        <div className="lex-app-brand">
          <div className="lex-app-brand-icon">
            <Activity
              size={20}
              strokeWidth={
                1.8
              }
            />
          </div>

          <div>
            <strong>
              LEX
            </strong>

            <span>
              MOBILE SCALPING
            </span>
          </div>
        </div>

        <div
          className={`lex-connection-state ${
            orderBookConnected
              ? 'connected'
              : 'disconnected'
          }`}
        >
          {orderBookConnected ? (
            <Wifi
              size={15}
              strokeWidth={
                1.7
              }
            />
          ) : (
            <WifiOff
              size={15}
              strokeWidth={
                1.7
              }
            />
          )}

          <span>
            {orderBookConnected
              ? 'LIVE'
              : orderBookLoading
                ? 'CONNECTING'
                : 'OFFLINE'}
          </span>
        </div>
      </header>

      {/* ===================================================
          MARKET SELECTOR
          =================================================== */}

      <section className="lex-market-selector">
        <div className="lex-market-selector-top">
          <div>
            <span className="lex-section-label">
              MARKET
            </span>

            <strong className="lex-selected-market">
              {market.base}

              <span>
                /{market.quote}
              </span>
            </strong>
          </div>

          <button
            type="button"
            className="lex-market-reload"
            onClick={
              reloadAll
            }
            disabled={
              marketLoading
            }
            aria-label="Reload market data"
          >
            <RefreshCw
              size={17}
              strokeWidth={
                1.7
              }
            />
          </button>
        </div>

        {/* MARKET SEARCH */}

        <form
          className="lex-market-search"
          onSubmit={
            handleMarketSubmit
          }
        >
          <Search
            size={16}
            strokeWidth={
              1.7
            }
          />

          <input
            type="text"
            value={
              marketInput
            }
            onChange={(
              event,
            ) => {
              setMarketInput(
                event.target.value,
              );
            }}
            placeholder="QNT, SOL, XRP, PEPE..."
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={
              false
            }
          />

          <button
            type="submit"
          >
            OPEN
          </button>
        </form>

        {/* QUICK MARKETS */}

        <div className="lex-quick-markets">
          {QUICK_MARKETS.map(
            (asset) => (
              <button
                key={
                  asset
                }
                type="button"
                className={
                  market.base ===
                  asset
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  changeMarket(
                    asset,
                  )
                }
              >
                {asset}
              </button>
            ),
          )}
        </div>
      </section>

      {/* ===================================================
          MARKET STATUS
          =================================================== */}

      <section className="lex-market-status">
        <div>
          <span>
            PRICE
          </span>

          <strong>
            {formatPrice(
              lastPrice,
            )}
          </strong>
        </div>

        <div>
          <span>
            PAIR
          </span>

          <strong>
            {gatePair}
          </strong>
        </div>

        <div>
          <span>
            TF
          </span>

          <strong>
            {timeframe}
          </strong>
        </div>

        <div>
          <span>
            LEVEL 2
          </span>

          <strong
            className={
              level2Live
                ? 'positive'
                : 'negative'
            }
          >
            {level2Live
              ? 'LIVE'
              : 'OFF'}
          </strong>
        </div>
      </section>

      {/* ===================================================
          ERRORS
          =================================================== */}

      {hasMarketError && (
        <section className="lex-market-error">
          {candlesError && (
            <div>
              <strong>
                CANDLES
              </strong>

              <span>
                {candlesError}
              </span>
            </div>
          )}

          {orderBookError && (
            <div>
              <strong>
                ORDER BOOK
              </strong>

              <span>
                {orderBookError}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={
              reloadAll
            }
          >
            RETRY
          </button>
        </section>
      )}

      {/* ===================================================
          LOADING
          =================================================== */}

      {marketLoading && (
        <div className="lex-market-loading">
          <Activity
            size={14}
            strokeWidth={
              1.7
            }
          />

          <span>
            LOADING {gatePair}
          </span>
        </div>
      )}

      {/* ===================================================
          LEX LADDER
          =================================================== */}

      <section className="lex-order-book-section">
        <div className="lex-section-heading">
          <div>
            <span className="lex-section-label">
              LEX LADDER
            </span>

            <strong>
              ORDER BOOK
            </strong>
          </div>

          {/* BOOK DEPTH */}

          <div className="lex-book-limit-control">
            {[50, 100, 200].map(
              (limit) => (
                <button
                  key={
                    limit
                  }
                  type="button"
                  className={
                    bookLimit ===
                    limit
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setBookLimit(
                      limit,
                    )
                  }
                >
                  {limit}
                </button>
              ),
            )}
          </div>
        </div>

        {/* REAL ORDER BOOK */}

        <LexOrderBook
          baseAsset={
            market.base
          }

          quoteAsset={
            market.quote
          }

          pair={
            gatePair
          }

          bids={
            bids
          }

          asks={
            asks
          }

          lastPrice={
            lastPrice
          }

          metrics={
            orderBookMetrics
          }

          connected={
            orderBookConnected
          }

          loading={
            orderBookLoading
          }

          error={
            orderBookError
          }
        />
      </section>

      {/* ===================================================
          LEX V2.4.1 FINAL CHART
          =================================================== */}

      <section className="lex-chart-section">
        <div className="lex-section-heading">
          <div>
            <span className="lex-section-label">
              MARKET ANALYSIS
            </span>

            <strong>
              LEX V2.4.1 FINAL
            </strong>
          </div>

          <span
            className={`lex-analysis-source ${
              level2Live
                ? 'live'
                : ''
            }`}
          >
            {level2Live
              ? heatmapLive
                ? 'OHLCV + L2 + HEATMAP'
                : 'OHLCV + LEVEL 2'
              : 'OHLCV'}
          </span>
        </div>

        {/* =================================================
            REAL CHART + LEX ENGINE

            IMPORTANT

            orderBookHeatmap is the historical sequence of
            liquidity snapshots.

            LexChart uses it for:

            - BID / ASK pressure
            - wall persistence
            - wall appearance
            - wall disappearance
            - wall growth
            - wall removal
            - approach / retreat
            - absorption
            - spoof filtering
            - heatmap score
            - final LEX confirmation
            ================================================= */}

        <LexChart
          baseAsset={
            market.base
          }

          quoteAsset={
            market.quote
          }

          pair={
            gatePair
          }

          lastPrice={
            lastPrice
          }

          priceChangePercent={
            priceChangePercent
          }

          candles={
            candles
          }

          timeframe={
            timeframe
          }

          onTimeframeChange={
            handleTimeframeChange
          }

          orderBookMetrics={
            orderBookMetrics
          }

          orderBookBids={
            bids
          }

          orderBookAsks={
            asks
          }

          orderBookHeatmap={
            orderBookHeatmap
          }

          candlesLoading={
            candlesLoading
          }

          candlesError={
            candlesError
          }
        />
      </section>

      {/* ===================================================
          DATA FOOTER
          =================================================== */}

      <footer className="lex-data-footer">
        <div>
          <span>
            CANDLES
          </span>

          <strong>
            {candles.length}
          </strong>
        </div>

        <div>
          <span>
            BIDS
          </span>

          <strong>
            {bids.length}
          </strong>
        </div>

        <div>
          <span>
            ASKS
          </span>

          <strong>
            {asks.length}
          </strong>
        </div>

        <div>
          <span>
            HEATMAP
          </span>

          <strong
            className={
              heatmapLive
                ? 'positive'
                : ''
            }
          >
            {heatmapSnapshots}
          </strong>
        </div>

        <div>
          <span>
            UPDATE
          </span>

          <strong>
            {lastUpdate > 0
              ? new Date(
                  lastUpdate,
                ).toLocaleTimeString(
                  [],
                  {
                    hour:
                      '2-digit',

                    minute:
                      '2-digit',

                    second:
                      '2-digit',
                  },
                )
              : '—'}
          </strong>
        </div>
      </footer>
    </main>
  );
}