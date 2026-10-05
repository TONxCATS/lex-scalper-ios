import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Activity,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Flame,
  Layers3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

/* =========================================================
   LEX ORDER BOOK
   src/components/LexOrderBook.tsx

   LEX V2.4.1 FINAL

   REAL DATA ONLY

   Source:
   Gate.io Level-2 order book

   Features:
   - ASK / BID price ladder
   - 100 ASK + 100 BID
   - current-price center
   - manual scrolling
   - optional FOLLOW mode
   - PAUSE visual ladder
   - iPhone pseudo fullscreen
   - native fullscreen where supported
   - real Level-2 depth
   - liquidity heatmap
   - large-order / wall detection
   - order lifetime
   - OBI
   - order flow
   - liquidity pressure
   - spread
   - microprice
   - absorption
   - replenishment
   - spoof-risk heuristic

   IMPORTANT

   No fake liquidity is generated.

   Heatmap intensity is derived only from
   real Gate.io order-book level sizes.
   ========================================================= */

/* =========================================================
   TYPES
   ========================================================= */

export type LexOrderBookLevel = {
  price: number;

  size: number;

  total?: number;

  ageMs?: number;

  firstSeenAt?: number;

  lastUpdatedAt?: number;

  updateCount?: number;

  isLarge?: boolean;
};

export type LexOrderBookMetrics = {
  obi: number;

  orderFlow: number;

  liquidityPressure: number;

  bidVolume: number;

  askVolume: number;

  bidWallPrice: number | null;

  askWallPrice: number | null;

  bidWallSize: number | null;

  askWallSize: number | null;

  spread: number | null;

  microPrice: number | null;

  absorption: number;

  replenishment: number;

  spoofRisk: number;

  updatedAt: number;
};

type LexOrderBookProps = {
  baseAsset: string;

  quoteAsset: string;

  pair: string;

  bids: LexOrderBookLevel[];

  asks: LexOrderBookLevel[];

  lastPrice: number | null;

  metrics: LexOrderBookMetrics | null;

  loading?: boolean;

  error?: string | null;

  connected?: boolean;
};

/* =========================================================
   CONSTANTS
   ========================================================= */

const MAX_VISIBLE_LEVELS = 200;

const DEFAULT_LEVELS_PER_SIDE = 100;

/*
 * Heatmap uses percentile-style normalization instead of
 * one absolute maximum.
 *
 * This prevents one giant wall from making every other
 * real liquidity level visually disappear.
 */

const HEATMAP_REFERENCE_PERCENTILE = 0.9;

/* =========================================================
   HELPERS
   ========================================================= */

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

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

  const absolute =
    Math.abs(
      value,
    );

  let digits = 2;

  if (
    absolute < 1000
  ) {
    digits = 3;
  }

  if (
    absolute < 100
  ) {
    digits = 4;
  }

  if (
    absolute < 1
  ) {
    digits = 6;
  }

  if (
    absolute < 0.01
  ) {
    digits = 8;
  }

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

function formatSize(
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

  const absolute =
    Math.abs(
      value,
    );

  if (
    absolute >=
    1_000_000_000
  ) {
    return `${(
      value /
      1_000_000_000
    ).toFixed(
      2,
    )}B`;
  }

  if (
    absolute >=
    1_000_000
  ) {
    return `${(
      value /
      1_000_000
    ).toFixed(
      2,
    )}M`;
  }

  if (
    absolute >=
    1000
  ) {
    return `${(
      value /
      1000
    ).toFixed(
      1,
    )}K`;
  }

  if (
    absolute >= 1
  ) {
    return value.toFixed(
      2,
    );
  }

  return value.toFixed(
    6,
  );
}

function formatAge(
  ageMs:
    number | undefined,
): string {
  if (
    ageMs === undefined ||
    !Number.isFinite(
      ageMs,
    ) ||
    ageMs < 0
  ) {
    return '—';
  }

  if (
    ageMs < 1000
  ) {
    return '<1s';
  }

  const seconds =
    Math.floor(
      ageMs / 1000,
    );

  if (
    seconds < 60
  ) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(
      seconds / 60,
    );

  const remainingSeconds =
    seconds % 60;

  if (
    minutes < 60
  ) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  const remainingMinutes =
    minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

function signed(
  value:
    number | null,
  digits = 1,
): string {
  if (
    value === null ||
    !Number.isFinite(
      value,
    )
  ) {
    return '—';
  }

  return `${
    value > 0
      ? '+'
      : ''
  }${value.toFixed(
    digits,
  )}`;
}

/* =========================================================
   PERCENTILE
   ========================================================= */

function percentile(
  values: number[],
  target: number,
): number {
  if (
    values.length === 0
  ) {
    return 0;
  }

  const sorted =
    [...values]
      .filter(
        (value) =>
          Number.isFinite(
            value,
          ) &&
          value > 0,
      )
      .sort(
        (
          a,
          b,
        ) =>
          a - b,
      );

  if (
    sorted.length === 0
  ) {
    return 0;
  }

  const safeTarget =
    clamp(
      target,
      0,
      1,
    );

  const index =
    Math.min(
      sorted.length - 1,
      Math.max(
        0,
        Math.floor(
          (
            sorted.length -
            1
          ) *
            safeTarget,
        ),
      ),
    );

  return (
    sorted[index] ??
    sorted[
      sorted.length - 1
    ] ??
    0
  );
}

/* =========================================================
   HEATMAP INTENSITY
   ========================================================= */

function calculateHeatIntensity(
  size: number,
  referenceSize: number,
): number {
  if (
    size <= 0 ||
    referenceSize <= 0
  ) {
    return 0;
  }

  /*
   * Square-root scaling preserves visibility of
   * medium liquidity while still highlighting walls.
   */

  const ratio =
    size /
    referenceSize;

  return clamp(
    Math.sqrt(
      ratio,
    ),
    0,
    1,
  );
}

/* =========================================================
   DEPTH WIDTH
   ========================================================= */

function calculateDepthPercent(
  size: number,
  referenceSize: number,
): number {
  return (
    calculateHeatIntensity(
      size,
      referenceSize,
    ) * 100
  );
}

/* =========================================================
   LEVEL ROW
   ========================================================= */

function OrderBookRow({
  side,
  level,
  referenceSize,
  quoteAsset,
  heatmapEnabled,
  wallsEnabled,
  isPrimaryWall,
}: {
  side:
    | 'bid'
    | 'ask';

  level:
    LexOrderBookLevel;

  referenceSize: number;

  quoteAsset: string;

  heatmapEnabled: boolean;

  wallsEnabled: boolean;

  isPrimaryWall: boolean;
}) {
  const intensity =
    calculateHeatIntensity(
      level.size,
      referenceSize,
    );

  const depthPercent =
    calculateDepthPercent(
      level.size,
      referenceSize,
    );

  const total =
    level.total ??
    level.price *
      level.size;

  const showWall =
    wallsEnabled &&
    (
      level.isLarge ||
      isPrimaryWall
    );

  /*
   * Keep opacity controlled.
   * We use CSS variables so the visual styling remains
   * centralized in CSS.
   */

  const style =
    {
      '--lex-depth-width':
        `${depthPercent}%`,

      '--lex-heat':
        String(
          intensity,
        ),
    } as React.CSSProperties;

  return (
    <div
      className={[
        'lex-book-row',
        side,
        heatmapEnabled
          ? ' heatmap-enabled'
          : '',
        showWall
          ? ' large-order'
          : '',
        isPrimaryWall
          ? ' primary-wall'
          : '',
      ]
        .filter(
          Boolean,
        )
        .join(
          ' ',
        )}
      style={
        style
      }
    >
      {heatmapEnabled && (
        <>
          <div className="lex-book-heatmap" />

          <div
            className="lex-book-depth"
            style={{
              width:
                `${depthPercent}%`,
            }}
          />
        </>
      )}

      <div className="lex-book-row-content">
        <span className="lex-book-price">
          {formatPrice(
            level.price,
          )}
        </span>

        <span className="lex-book-size">
          {formatSize(
            level.size,
          )}
        </span>

        <span className="lex-book-total">
          {formatSize(
            total,
          )}
        </span>

        <span className="lex-book-age">
          {showWall && (
            <Timer
              size={11}
              strokeWidth={
                1.6
              }
            />
          )}

          {formatAge(
            level.ageMs,
          )}
        </span>
      </div>

      {showWall && (
        <span className="lex-large-order-marker">
          {isPrimaryWall
            ? 'WALL'
            : 'LARGE'}
        </span>
      )}

      <span
        className="lex-book-row-quote"
        aria-hidden="true"
      >
        {quoteAsset}
      </span>
    </div>
  );
}

/* =========================================================
   CURRENT PRICE ROW
   ========================================================= */

function CurrentPriceRow({
  lastPrice,
  bestBid,
  bestAsk,
}: {
  lastPrice:
    number | null;

  bestBid:
    number | null;

  bestAsk:
    number | null;
}) {
  const midpoint =
    bestBid !== null &&
    bestAsk !== null
      ? (
          bestBid +
          bestAsk
        ) / 2
      : null;

  const visiblePrice =
    lastPrice ??
    midpoint ??
    bestBid ??
    bestAsk;

  return (
    <div className="lex-current-price-row">
      <div className="lex-current-price-line" />

      <div className="lex-current-price-value">
        <Crosshair
          size={15}
          strokeWidth={
            1.7
          }
        />

        <strong>
          {formatPrice(
            visiblePrice,
          )}
        </strong>

        <span>
          CURRENT
        </span>
      </div>

      <div className="lex-current-price-line" />
    </div>
  );
}

/* =========================================================
   METRIC CELL
   ========================================================= */

function MetricCell({
  label,
  value,
  direction,
}: {
  label: string;

  value: string;

  direction?:
    | 'positive'
    | 'negative'
    | 'neutral';
}) {
  return (
    <div className="lex-book-metric">
      <span>
        {label}
      </span>

      <strong
        className={
          direction ===
          'positive'
            ? 'positive'
            : direction ===
                'negative'
              ? 'negative'
              : ''
        }
      >
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   LEX LEVEL-2 ANALYSIS
   ========================================================= */

function Level2Analysis({
  metrics,
}: {
  metrics:
    LexOrderBookMetrics | null;
}) {
  if (!metrics) {
    return (
      <section className="lex-book-analysis">
        <div className="lex-book-analysis-header">
          <div>
            <Activity
              size={15}
              strokeWidth={
                1.7
              }
            />

            <span>
              LEX V2.4.1 LEVEL-2
            </span>
          </div>

          <span>
            WAITING
          </span>
        </div>

        <div className="lex-level2-empty">
          Waiting for real
          Gate.io Level-2 data…
        </div>
      </section>
    );
  }

  const obiDirection =
    metrics.obi > 0.05
      ? 'positive'
      : metrics.obi <
          -0.05
        ? 'negative'
        : 'neutral';

  const flowDirection =
    metrics.orderFlow >
    0.05
      ? 'positive'
      : metrics.orderFlow <
          -0.05
        ? 'negative'
        : 'neutral';

  const liquidityDirection =
    metrics.liquidityPressure >
    0.05
      ? 'positive'
      : metrics.liquidityPressure <
          -0.05
        ? 'negative'
        : 'neutral';

  const absorptionDirection =
    metrics.absorption >
    0.05
      ? 'positive'
      : metrics.absorption <
          -0.05
        ? 'negative'
        : 'neutral';

  const replenishmentDirection =
    metrics.replenishment >
    0.05
      ? 'positive'
      : metrics.replenishment <
          -0.05
        ? 'negative'
        : 'neutral';

  return (
    <section className="lex-book-analysis">
      <div className="lex-book-analysis-header">
        <div>
          <Activity
            size={15}
            strokeWidth={
              1.7
            }
          />

          <span>
            LEX V2.4.1 LEVEL-2
          </span>
        </div>

        <span className="live">
          LIVE
        </span>
      </div>

      <div className="lex-book-metrics-grid">
        <MetricCell
          label="OBI"
          value={`${signed(
            metrics.obi *
              100,
            1,
          )}%`}
          direction={
            obiDirection
          }
        />

        <MetricCell
          label="ORDER FLOW"
          value={`${signed(
            metrics.orderFlow *
              100,
            1,
          )}%`}
          direction={
            flowDirection
          }
        />

        <MetricCell
          label="LIQ PRESSURE"
          value={`${signed(
            metrics.liquidityPressure *
              100,
            1,
          )}%`}
          direction={
            liquidityDirection
          }
        />

        <MetricCell
          label="SPREAD"
          value={formatPrice(
            metrics.spread,
          )}
        />

        <MetricCell
          label="MICROPRICE"
          value={formatPrice(
            metrics.microPrice,
          )}
        />

        <MetricCell
          label="BID VOL"
          value={formatSize(
            metrics.bidVolume,
          )}
          direction="positive"
        />

        <MetricCell
          label="ASK VOL"
          value={formatSize(
            metrics.askVolume,
          )}
          direction="negative"
        />

        <MetricCell
          label="ABSORPTION"
          value={`${signed(
            metrics.absorption *
              100,
            1,
          )}%`}
          direction={
            absorptionDirection
          }
        />

        <MetricCell
          label="REPLENISH"
          value={`${signed(
            metrics.replenishment *
              100,
            1,
          )}%`}
          direction={
            replenishmentDirection
          }
        />

        <MetricCell
          label="SPOOF RISK"
          value={`${clamp(
            metrics.spoofRisk *
              100,
            0,
            100,
          ).toFixed(
            0,
          )}%`}
          direction={
            metrics.spoofRisk >=
            0.65
              ? 'negative'
              : 'neutral'
          }
        />
      </div>

      <div className="lex-wall-grid">
        <div className="bid">
          <span>
            BID WALL
          </span>

          <strong>
            {formatPrice(
              metrics.bidWallPrice,
            )}
          </strong>

          <small>
            {formatSize(
              metrics.bidWallSize,
            )}
          </small>
        </div>

        <div className="ask">
          <span>
            ASK WALL
          </span>

          <strong>
            {formatPrice(
              metrics.askWallPrice,
            )}
          </strong>

          <small>
            {formatSize(
              metrics.askWallSize,
            )}
          </small>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   MAIN
   ========================================================= */

export default function LexOrderBook({
  baseAsset,
  quoteAsset,
  pair,
  bids,
  asks,
  lastPrice,
  metrics,
  loading = false,
  error = null,
  connected = false,
}: LexOrderBookProps) {
  const screenRef =
    useRef<HTMLElement | null>(
      null,
    );

  const ladderRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const manualScrollRef =
    useRef(false);

  const [
    followPrice,
    setFollowPrice,
  ] =
    useState(true);

  const [
    paused,
    setPaused,
  ] =
    useState(false);

  const [
    heatmapEnabled,
    setHeatmapEnabled,
  ] =
    useState(true);

  const [
    wallsEnabled,
    setWallsEnabled,
  ] =
    useState(true);

  const [
    pseudoFullscreen,
    setPseudoFullscreen,
  ] =
    useState(false);

  const [
    nativeFullscreen,
    setNativeFullscreen,
  ] =
    useState(false);

  /* =======================================================
     FROZEN VISUAL DATA
     ======================================================= */

  const [
    frozenBids,
    setFrozenBids,
  ] =
    useState<
      LexOrderBookLevel[]
    >([]);

  const [
    frozenAsks,
    setFrozenAsks,
  ] =
    useState<
      LexOrderBookLevel[]
    >([]);

  const [
    frozenPrice,
    setFrozenPrice,
  ] =
    useState<
      number | null
    >(lastPrice);

  useEffect(() => {
    if (paused) {
      return;
    }

    setFrozenBids(
      bids,
    );

    setFrozenAsks(
      asks,
    );

    setFrozenPrice(
      lastPrice,
    );
  }, [
    asks,
    bids,
    lastPrice,
    paused,
  ]);

  /* =======================================================
     VISIBLE LEVELS
     ======================================================= */

  const visibleBids =
    useMemo(
      () =>
        [...frozenBids]
          .sort(
            (
              a,
              b,
            ) =>
              b.price -
              a.price,
          )
          .slice(
            0,
            DEFAULT_LEVELS_PER_SIDE,
          ),
      [
        frozenBids,
      ],
    );

  const visibleAsks =
    useMemo(
      () =>
        [...frozenAsks]
          .sort(
            (
              a,
              b,
            ) =>
              a.price -
              b.price,
          )
          .slice(
            0,
            DEFAULT_LEVELS_PER_SIDE,
          )
          .reverse(),
      [
        frozenAsks,
      ],
    );

  const totalLevels =
    Math.min(
      MAX_VISIBLE_LEVELS,
      visibleBids.length +
        visibleAsks.length,
    );

  /* =======================================================
     BEST BID / ASK
     ======================================================= */

  const bestBid =
    useMemo(() => {
      if (
        visibleBids.length ===
        0
      ) {
        return null;
      }

      return (
        visibleBids[0]
          ?.price ??
        null
      );
    }, [
      visibleBids,
    ]);

  const bestAsk =
    useMemo(() => {
      if (
        visibleAsks.length ===
        0
      ) {
        return null;
      }

      /*
       * ASK array is reversed visually.
       * The nearest ASK is therefore the last row.
       */

      return (
        visibleAsks[
          visibleAsks.length -
            1
        ]?.price ??
        null
      );
    }, [
      visibleAsks,
    ]);

  /* =======================================================
     HEATMAP REFERENCE

     90th percentile rather than absolute maximum.
     ======================================================= */

  const heatmapReferenceSize =
    useMemo(() => {
      const sizes = [
        ...visibleBids.map(
          (level) =>
            level.size,
        ),

        ...visibleAsks.map(
          (level) =>
            level.size,
        ),
      ];

      const reference =
        percentile(
          sizes,
          HEATMAP_REFERENCE_PERCENTILE,
        );

      if (
        reference > 0
      ) {
        return reference;
      }

      return Math.max(
        0,
        ...sizes,
      );
    }, [
      visibleAsks,
      visibleBids,
    ]);

  /* =======================================================
     PRIMARY WALL PRICES
     ======================================================= */

  const bidWallPrice =
    metrics?.bidWallPrice ??
    null;

  const askWallPrice =
    metrics?.askWallPrice ??
    null;

  const isSamePrice =
    useCallback(
      (
        first: number,
        second:
          number | null,
      ) => {
        if (
          second === null
        ) {
          return false;
        }

        const tolerance =
          Math.max(
            Math.abs(
              first,
            ),
            Math.abs(
              second,
            ),
            1,
          ) *
          1e-10;

        return (
          Math.abs(
            first -
              second,
          ) <=
          tolerance
        );
      },
      [],
    );

  /* =======================================================
     CENTER CURRENT PRICE
     ======================================================= */

  const centerPrice =
    useCallback(
      () => {
        const ladder =
          ladderRef.current;

        if (!ladder) {
          return;
        }

        const marker =
          ladder.querySelector(
            '.lex-current-price-row',
          ) as
            | HTMLElement
            | null;

        if (!marker) {
          return;
        }

        const target =
          marker.offsetTop -
          ladder.clientHeight /
            2 +
          marker.clientHeight /
            2;

        manualScrollRef.current =
          false;

        ladder.scrollTo({
          top:
            Math.max(
              0,
              target,
            ),

          behavior:
            'auto',
        });
      },
      [],
    );

  /* =======================================================
     FOLLOW PRICE

     Important:
     We do NOT center on every tick.

     The current-price row itself remains structurally
     between ASK and BID.

     Re-centering occurs when FOLLOW is activated,
     pair changes, or visible ladder is rebuilt.
     ======================================================= */

  useEffect(() => {
    if (
      !followPrice ||
      paused
    ) {
      return;
    }

    const frame =
      window.requestAnimationFrame(
        () => {
          centerPrice();
        },
      );

    return () => {
      window.cancelAnimationFrame(
        frame,
      );
    };
  }, [
    centerPrice,
    followPrice,
    pair,
    paused,
  ]);

  /* =======================================================
     MANUAL INTERACTION
     ======================================================= */

  const disableFollowForManualScroll =
    useCallback(
      () => {
        manualScrollRef.current =
          true;

        setFollowPrice(
          false,
        );
      },
      [],
    );

  /* =======================================================
     FULLSCREEN STATE
     ======================================================= */

  useEffect(() => {
    const handler =
      () => {
        setNativeFullscreen(
          document.fullscreenElement ===
            screenRef.current,
        );
      };

    document.addEventListener(
      'fullscreenchange',
      handler,
    );

    return () => {
      document.removeEventListener(
        'fullscreenchange',
        handler,
      );
    };
  }, []);

  /* =======================================================
     FULLSCREEN
     ======================================================= */

  const handleFullscreen =
    async () => {
      const element =
        screenRef.current;

      if (!element) {
        return;
      }

      if (
        pseudoFullscreen
      ) {
        setPseudoFullscreen(
          false,
        );

        document.body.classList.remove(
          'lex-orderbook-fullscreen-open',
        );

        return;
      }

      if (
        document.fullscreenElement
      ) {
        try {
          await document.exitFullscreen();
        } catch {
          /*
           * iPhone fallback.
           */
        }

        return;
      }

      try {
        if (
          element.requestFullscreen
        ) {
          await element.requestFullscreen();

          return;
        }
      } catch {
        /*
         * Safari / iPhone fallback.
         */
      }

      setPseudoFullscreen(
        true,
      );

      document.body.classList.add(
        'lex-orderbook-fullscreen-open',
      );
    };

  useEffect(() => {
    return () => {
      document.body.classList.remove(
        'lex-orderbook-fullscreen-open',
      );
    };
  }, []);

  const fullscreen =
    pseudoFullscreen ||
    nativeFullscreen;

  /* =======================================================
     LIVE DIRECTION
     ======================================================= */

  const liquidityDirection =
    metrics === null
      ? 'neutral'
      : metrics.liquidityPressure >
          0.05
        ? 'positive'
        : metrics.liquidityPressure <
            -0.05
          ? 'negative'
          : 'neutral';

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <section
      ref={
        screenRef
      }
      className={[
        'lex-order-book',
        pseudoFullscreen
          ? 'lex-order-book-pseudo-fullscreen'
          : '',
        heatmapEnabled
          ? 'lex-heatmap-active'
          : '',
      ]
        .filter(
          Boolean,
        )
        .join(
          ' ',
        )}
      aria-label={`${baseAsset} ${quoteAsset} order book`}
    >
      {/* ===================================================
          HEADER
          =================================================== */}

      <div className="lex-order-book-header">
        <div className="lex-order-book-title">
          <div>
            <Layers3
              size={17}
              strokeWidth={
                1.7
              }
            />

            <strong>
              LEX LADDER
            </strong>
          </div>

          <span>
            {baseAsset}
            {' / '}
            {quoteAsset}
          </span>
        </div>

        <div className="lex-order-book-actions">
          {/* FOLLOW */}

          <button
            type="button"
            className={
              followPrice
                ? 'active'
                : ''
            }
            aria-pressed={
              followPrice
            }
            onClick={() => {
              const next =
                !followPrice;

              setFollowPrice(
                next,
              );

              if (next) {
                window.requestAnimationFrame(
                  () => {
                    centerPrice();
                  },
                );
              }
            }}
          >
            <Crosshair
              size={15}
              strokeWidth={
                1.7
              }
            />

            <span>
              FOLLOW
            </span>
          </button>

          {/* HEATMAP */}

          <button
            type="button"
            className={
              heatmapEnabled
                ? 'active heatmap'
                : ''
            }
            aria-pressed={
              heatmapEnabled
            }
            onClick={() => {
              setHeatmapEnabled(
                (
                  value,
                ) =>
                  !value,
              );
            }}
          >
            <Flame
              size={15}
              strokeWidth={
                1.7
              }
            />

            <span>
              HEAT
            </span>
          </button>

          {/* WALLS */}

          <button
            type="button"
            className={
              wallsEnabled
                ? 'active'
                : ''
            }
            aria-pressed={
              wallsEnabled
            }
            onClick={() => {
              setWallsEnabled(
                (
                  value,
                ) =>
                  !value,
              );
            }}
          >
            <Layers3
              size={15}
              strokeWidth={
                1.7
              }
            />

            <span>
              WALLS
            </span>
          </button>

          {/* PAUSE */}

          <button
            type="button"
            className={
              paused
                ? 'active'
                : ''
            }
            aria-pressed={
              paused
            }
            onClick={() => {
              setPaused(
                (
                  value,
                ) =>
                  !value,
              );
            }}
            aria-label={
              paused
                ? 'Resume order book'
                : 'Pause order book'
            }
          >
            {paused ? (
              <Play
                size={15}
                strokeWidth={
                  1.7
                }
              />
            ) : (
              <Pause
                size={15}
                strokeWidth={
                  1.7
                }
              />
            )}
          </button>

          {/* FULLSCREEN */}

          <button
            type="button"
            onClick={
              handleFullscreen
            }
            aria-label={
              fullscreen
                ? 'Exit fullscreen'
                : 'Open fullscreen'
            }
          >
            {fullscreen ? (
              <Minimize2
                size={16}
                strokeWidth={
                  1.7
                }
              />
            ) : (
              <Maximize2
                size={16}
                strokeWidth={
                  1.7
                }
              />
            )}
          </button>
        </div>
      </div>

      {/* ===================================================
          STATUS
          =================================================== */}

      <div className="lex-order-book-status">
        <div>
          <span
            className={`lex-connection-dot${
              connected
                ? ' connected'
                : ''
            }`}
          />

          <strong>
            {connected
              ? paused
                ? 'PAUSED'
                : 'LIVE'
              : loading
                ? 'CONNECTING'
                : 'OFFLINE'}
          </strong>

          <span>
            Gate.io
          </span>
        </div>

        <div>
          <span>
            {totalLevels}
          </span>

          <small>
            LEVELS
          </small>
        </div>
      </div>

      {/* ===================================================
          QUICK FLOW STATUS
          =================================================== */}

      {metrics && (
        <div className="lex-order-book-flow-strip">
          <div>
            <span>
              OBI
            </span>

            <strong
              className={
                metrics.obi >
                0.05
                  ? 'positive'
                  : metrics.obi <
                      -0.05
                    ? 'negative'
                    : ''
              }
            >
              {signed(
                metrics.obi *
                  100,
                1,
              )}
              %
            </strong>
          </div>

          <div>
            <span>
              FLOW
            </span>

            <strong
              className={
                metrics.orderFlow >
                0.05
                  ? 'positive'
                  : metrics.orderFlow <
                      -0.05
                    ? 'negative'
                    : ''
              }
            >
              {signed(
                metrics.orderFlow *
                  100,
                1,
              )}
              %
            </strong>
          </div>

          <div>
            <span>
              LIQ
            </span>

            <strong
              className={
                liquidityDirection ===
                'positive'
                  ? 'positive'
                  : liquidityDirection ===
                      'negative'
                    ? 'negative'
                    : ''
              }
            >
              {signed(
                metrics.liquidityPressure *
                  100,
                1,
              )}
              %
            </strong>
          </div>

          <div>
            <span>
              SPOOF
            </span>

            <strong
              className={
                metrics.spoofRisk >=
                0.65
                  ? 'negative'
                  : ''
              }
            >
              {clamp(
                metrics.spoofRisk *
                  100,
                0,
                100,
              ).toFixed(
                0,
              )}
              %
            </strong>
          </div>
        </div>
      )}

      {/* ===================================================
          ERROR
          =================================================== */}

      {error && (
        <div className="lex-order-book-error">
          <ShieldAlert
            size={15}
            strokeWidth={
              1.7
            }
          />

          <span>
            {error}
          </span>
        </div>
      )}

      {/* ===================================================
          COLUMN HEADER
          =================================================== */}

      <div className="lex-book-columns">
        <span>
          PRICE
        </span>

        <span>
          SIZE
        </span>

        <span>
          TOTAL
        </span>

        <span>
          AGE
        </span>
      </div>

      {/* ===================================================
          PRICE LADDER
          =================================================== */}

      <div
        ref={
          ladderRef
        }
        className="lex-price-ladder"
        onTouchStart={
          disableFollowForManualScroll
        }
        onPointerDown={(
          event,
        ) => {
          if (
            event.pointerType ===
              'touch' ||
            event.pointerType ===
              'pen'
          ) {
            disableFollowForManualScroll();
          }
        }}
        onWheel={
          disableFollowForManualScroll
        }
      >
        {/* =================================================
            ASK
            ================================================= */}

        <div className="lex-book-side lex-book-asks">
          <div className="lex-book-side-label ask">
            <TrendingDown
              size={13}
              strokeWidth={
                1.7
              }
            />

            <span>
              ASK
            </span>

            <ChevronUp
              size={13}
              strokeWidth={
                1.7
              }
            />
          </div>

          {visibleAsks.length >
          0 ? (
            visibleAsks.map(
              (
                level,
              ) => (
                <OrderBookRow
                  key={`ask-${level.price}`}
                  side="ask"
                  level={
                    level
                  }
                  referenceSize={
                    heatmapReferenceSize
                  }
                  quoteAsset={
                    quoteAsset
                  }
                  heatmapEnabled={
                    heatmapEnabled
                  }
                  wallsEnabled={
                    wallsEnabled
                  }
                  isPrimaryWall={isSamePrice(
                    level.price,
                    askWallPrice,
                  )}
                />
              ),
            )
          ) : (
            <div className="lex-book-empty">
              {loading
                ? 'Loading ASK levels…'
                : 'No ASK levels'}
            </div>
          )}
        </div>

        {/* =================================================
            CURRENT PRICE
            ================================================= */}

        <CurrentPriceRow
          lastPrice={
            frozenPrice
          }
          bestBid={
            bestBid
          }
          bestAsk={
            bestAsk
          }
        />

        {/* =================================================
            BID
            ================================================= */}

        <div className="lex-book-side lex-book-bids">
          <div className="lex-book-side-label bid">
            <TrendingUp
              size={13}
              strokeWidth={
                1.7
              }
            />

            <span>
              BID
            </span>

            <ChevronDown
              size={13}
              strokeWidth={
                1.7
              }
            />
          </div>

          {visibleBids.length >
          0 ? (
            visibleBids.map(
              (
                level,
              ) => (
                <OrderBookRow
                  key={`bid-${level.price}`}
                  side="bid"
                  level={
                    level
                  }
                  referenceSize={
                    heatmapReferenceSize
                  }
                  quoteAsset={
                    quoteAsset
                  }
                  heatmapEnabled={
                    heatmapEnabled
                  }
                  wallsEnabled={
                    wallsEnabled
                  }
                  isPrimaryWall={isSamePrice(
                    level.price,
                    bidWallPrice,
                  )}
                />
              ),
            )
          ) : (
            <div className="lex-book-empty">
              {loading
                ? 'Loading BID levels…'
                : 'No BID levels'}
            </div>
          )}
        </div>
      </div>

      {/* ===================================================
          LADDER CONTROLS
          =================================================== */}

      <div className="lex-ladder-controls">
        <button
          type="button"
          onClick={() => {
            setFollowPrice(
              true,
            );

            window.requestAnimationFrame(
              () => {
                centerPrice();
              },
            );
          }}
        >
          <Crosshair
            size={14}
            strokeWidth={
              1.7
            }
          />

          <span>
            CENTER
          </span>
        </button>

        <button
          type="button"
          className={
            heatmapEnabled
              ? 'active'
              : ''
          }
          onClick={() => {
            setHeatmapEnabled(
              (
                value,
              ) =>
                !value,
            );
          }}
        >
          <Flame
            size={14}
            strokeWidth={
              1.7
            }
          />

          <span>
            HEATMAP
          </span>
        </button>

        <div className="lex-ladder-live-source">
          <RefreshCw
            size={12}
            strokeWidth={
              1.7
            }
          />

          <span>
            REAL LEVEL-2
          </span>
        </div>
      </div>

      {/* ===================================================
          LEVEL-2 ANALYSIS
          =================================================== */}

      <Level2Analysis
        metrics={
          metrics
        }
      />

      {/* ===================================================
          FOOTER
          =================================================== */}

      <div className="lex-order-book-footer">
        <span>
          LEX V2.4.1 FINAL
        </span>

        <span>
          {pair}
        </span>
      </div>
    </section>
  );
}