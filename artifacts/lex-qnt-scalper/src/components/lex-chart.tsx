import {
  memo,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Activity,
  BarChart3,
  CandlestickChart,
  Layers3,
  Maximize2,
  Minimize2,
} from 'lucide-react';

import type {
  GateTimeframe,
} from '@/hooks/use-gate-candles';

/* =========================================================
   LEX V2.4.1 F — CHART SCREEN

   IMPORTANT:
   - timeframe is controlled by App.tsx
   - no local timeframe state
   - real Gate.io OHLCV candles only
   - no fake candles
   ========================================================= */

/* =========================================================
   CANDLE TYPE

   This accepts the common Gate candle shape used by the app.
   If the hook exports its own candle type later, this can be
   replaced by an imported type without changing the renderer.
   ========================================================= */

export type LexCandle = {
  timestamp?: number;
  time?: number;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/* =========================================================
   PROPS
   ========================================================= */

type LexChartProps = {
  baseAsset: string;
  quoteAsset: string;

  lastPrice: number | null;
  priceChangePercent: number | null;

  candles: LexCandle[];

  timeframe: GateTimeframe;

  onTimeframeChange: (
    timeframe: GateTimeframe,
  ) => void;

  loading?: boolean;
};

/* =========================================================
   TIMEFRAMES

   Gate.io timeframe values are lowercase:
   1m / 5m / 15m / 30m / 1h / 4h / 1d
   ========================================================= */

const TIMEFRAMES: Array<{
  value: GateTimeframe;
  label: string;
}> = [
  {
    value: '1m',
    label: '1m',
  },
  {
    value: '5m',
    label: '5m',
  },
  {
    value: '15m',
    label: '15m',
  },
  {
    value: '30m',
    label: '30m',
  },
  {
    value: '1h',
    label: '1H',
  },
  {
    value: '4h',
    label: '4H',
  },
  {
    value: '1d',
    label: '1D',
  },
];

/* =========================================================
   FORMATTERS
   ========================================================= */

function formatChartPrice(
  value: number | null,
) {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return '—';
  }

  const digits =
    value >= 1000
      ? 2
      : value >= 100
        ? 2
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

function formatCompact(
  value: number,
) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  if (
    Math.abs(value) >=
    1_000_000_000
  ) {
    return `${(
      value /
      1_000_000_000
    ).toFixed(1)}B`;
  }

  if (
    Math.abs(value) >=
    1_000_000
  ) {
    return `${(
      value /
      1_000_000
    ).toFixed(1)}M`;
  }

  if (
    Math.abs(value) >=
    1_000
  ) {
    return `${(
      value /
      1_000
    ).toFixed(1)}K`;
  }

  return value.toLocaleString(
    'en-US',
    {
      maximumFractionDigits: 2,
    },
  );
}

function timeframeLabel(
  timeframe: GateTimeframe,
) {
  return (
    TIMEFRAMES.find(
      (item) =>
        item.value ===
        timeframe,
    )?.label ??
    timeframe.toUpperCase()
  );
}

/* =========================================================
   CANDLE NORMALIZATION
   ========================================================= */

type NormalizedCandle = {
  timestamp: number;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function normalizeCandles(
  candles: LexCandle[],
): NormalizedCandle[] {
  return candles
    .map(
      (
        candle,
        index,
      ): NormalizedCandle => {
        const rawTime =
          candle.timestamp ??
          candle.time ??
          index;

        return {
          timestamp:
            Number(rawTime),

          open:
            Number(candle.open),

          high:
            Number(candle.high),

          low:
            Number(candle.low),

          close:
            Number(candle.close),

          volume:
            Number(
              candle.volume,
            ),
        };
      },
    )
    .filter(
      (candle) =>
        Number.isFinite(
          candle.open,
        ) &&
        Number.isFinite(
          candle.high,
        ) &&
        Number.isFinite(
          candle.low,
        ) &&
        Number.isFinite(
          candle.close,
        ) &&
        Number.isFinite(
          candle.volume,
        ),
    );
}

/* =========================================================
   TIMEFRAME SELECTOR
   ========================================================= */

function TimeframeSelector({
  value,
  onChange,
}: {
  value: GateTimeframe;

  onChange: (
    value: GateTimeframe,
  ) => void;
}) {
  return (
    <div
      className="lex-timeframes"
      role="group"
      aria-label="Chart timeframe"
    >
      {TIMEFRAMES.map(
        (item) => (
          <button
            key={item.value}
            type="button"
            className={`lex-timeframe-button${
              value ===
              item.value
                ? ' active'
                : ''
            }`}
            onClick={() =>
              onChange(
                item.value,
              )
            }
            aria-pressed={
              value ===
              item.value
            }
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/* =========================================================
   REAL CANDLE CHART

   Pure SVG renderer.
   No external chart dependency.
   No generated/fake candles.
   ========================================================= */

const RealCandleChart = memo(
  function RealCandleChart({
    candles,
    lastPrice,
    loading,
  }: {
    candles: NormalizedCandle[];
    lastPrice: number | null;
    loading: boolean;
  }) {
    const chartData =
      useMemo(
        () =>
          candles.slice(
            -120,
          ),
        [candles],
      );

    const geometry =
      useMemo(() => {
        if (
          chartData.length ===
          0
        ) {
          return null;
        }

        const highs =
          chartData.map(
            (candle) =>
              candle.high,
          );

        const lows =
          chartData.map(
            (candle) =>
              candle.low,
          );

        let minPrice =
          Math.min(...lows);

        let maxPrice =
          Math.max(...highs);

        if (
          !Number.isFinite(
            minPrice,
          ) ||
          !Number.isFinite(
            maxPrice,
          )
        ) {
          return null;
        }

        if (
          maxPrice ===
          minPrice
        ) {
          const padding =
            Math.max(
              Math.abs(
                maxPrice,
              ) * 0.01,
              0.00000001,
            );

          minPrice -=
            padding;

          maxPrice +=
            padding;
        }

        const range =
          maxPrice -
          minPrice;

        const padding =
          range * 0.08;

        minPrice -=
          padding;

        maxPrice +=
          padding;

        const paddedRange =
          maxPrice -
          minPrice;

        const width =
          1000;

        const height =
          650;

        const top =
          24;

        const bottom =
          34;

        const left =
          10;

        const right =
          115;

        const plotWidth =
          width -
          left -
          right;

        const plotHeight =
          height -
          top -
          bottom;

        const step =
          plotWidth /
          Math.max(
            1,
            chartData.length,
          );

        const candleWidth =
          Math.max(
            2.2,
            Math.min(
              10,
              step * 0.62,
            ),
          );

        const priceToY = (
          price: number,
        ) =>
          top +
          ((maxPrice -
            price) /
            paddedRange) *
            plotHeight;

        return {
          width,
          height,
          top,
          bottom,
          left,
          right,
          plotWidth,
          plotHeight,
          step,
          candleWidth,
          minPrice,
          maxPrice,
          priceToY,
        };
      }, [chartData]);

    if (
      loading &&
      chartData.length ===
        0
    ) {
      return (
        <div className="lex-chart-stage lex-chart-loading">
          <CandlestickChart
            size={28}
            strokeWidth={1.4}
          />

          <span>
            Loading real Gate.io OHLCV…
          </span>
        </div>
      );
    }

    if (
      !geometry ||
      chartData.length ===
        0
    ) {
      return (
        <div className="lex-chart-stage">
          <div className="lex-chart-grid" />

          <div className="lex-chart-watermark">
            <CandlestickChart
              size={30}
              strokeWidth={1.4}
            />

            <strong>
              NO OHLCV DATA
            </strong>

            <span>
              Waiting for Gate.io candles
            </span>
          </div>
        </div>
      );
    }

    const {
      width,
      height,
      top,
      left,
      right,
      plotWidth,
      plotHeight,
      step,
      candleWidth,
      minPrice,
      maxPrice,
      priceToY,
    } = geometry;

    const gridLines =
      Array.from(
        {
          length: 6,
        },
        (_, index) => {
          const ratio =
            index / 5;

          const price =
            maxPrice -
            (maxPrice -
              minPrice) *
              ratio;

          const y =
            top +
            plotHeight *
              ratio;

          return {
            price,
            y,
          };
        },
      );

    const effectivePrice =
      lastPrice ??
      chartData[
        chartData.length -
          1
      ]?.close ??
      null;

    const priceInRange =
      effectivePrice !==
        null &&
      effectivePrice >=
        minPrice &&
      effectivePrice <=
        maxPrice;

    const currentPriceY =
      priceInRange &&
      effectivePrice !==
        null
        ? priceToY(
            effectivePrice,
          )
        : null;

    return (
      <div className="lex-chart-stage lex-real-chart-stage">
        <svg
          className="lex-candle-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Real Gate.io candlestick chart"
        >
          <rect
            x="0"
            y="0"
            width={width}
            height={height}
            className="lex-chart-svg-background"
          />

          {/* HORIZONTAL GRID */}

          {gridLines.map(
            (
              line,
              index,
            ) => (
              <g
                key={`horizontal-${index}`}
              >
                <line
                  x1={left}
                  y1={line.y}
                  x2={
                    width -
                    right
                  }
                  y2={line.y}
                  className="lex-chart-grid-line"
                />

                <text
                  x={
                    width -
                    right +
                    22
                  }
                  y={
                    line.y +
                    5
                  }
                  className="lex-chart-axis-label"
                >
                  {formatChartPrice(
                    line.price,
                  )}
                </text>
              </g>
            ),
          )}

          {/* VERTICAL GRID */}

          {[
            0,
            0.25,
            0.5,
            0.75,
            1,
          ].map(
            (
              ratio,
              index,
            ) => {
              const x =
                left +
                plotWidth *
                  ratio;

              return (
                <line
                  key={`vertical-${index}`}
                  x1={x}
                  y1={top}
                  x2={x}
                  y2={
                    top +
                    plotHeight
                  }
                  className="lex-chart-grid-line lex-chart-grid-line-vertical"
                />
              );
            },
          )}

          {/* CANDLES */}

          {chartData.map(
            (
              candle,
              index,
            ) => {
              const x =
                left +
                step *
                  index +
                step / 2;

              const openY =
                priceToY(
                  candle.open,
                );

              const closeY =
                priceToY(
                  candle.close,
                );

              const highY =
                priceToY(
                  candle.high,
                );

              const lowY =
                priceToY(
                  candle.low,
                );

              const bullish =
                candle.close >=
                candle.open;

              const bodyTop =
                Math.min(
                  openY,
                  closeY,
                );

              const bodyHeight =
                Math.max(
                  1.8,
                  Math.abs(
                    closeY -
                      openY,
                  ),
                );

              return (
                <g
                  key={`${candle.timestamp}-${index}`}
                  className={
                    bullish
                      ? 'lex-candle bullish'
                      : 'lex-candle bearish'
                  }
                >
                  <line
                    x1={x}
                    x2={x}
                    y1={highY}
                    y2={lowY}
                    className="lex-candle-wick"
                  />

                  <rect
                    x={
                      x -
                      candleWidth /
                        2
                    }
                    y={bodyTop}
                    width={
                      candleWidth
                    }
                    height={
                      bodyHeight
                    }
                    rx="0.8"
                    className="lex-candle-body"
                  />
                </g>
              );
            },
          )}

          {/* CURRENT PRICE */}

          {currentPriceY !==
            null &&
            effectivePrice !==
              null && (
              <>
                <line
                  x1={left}
                  y1={
                    currentPriceY
                  }
                  x2={
                    width -
                    right
                  }
                  y2={
                    currentPriceY
                  }
                  className="lex-current-price-line"
                />

                <rect
                  x={
                    width -
                    right +
                    10
                  }
                  y={
                    currentPriceY -
                    15
                  }
                  width="92"
                  height="30"
                  rx="4"
                  className="lex-current-price-box"
                />

                <text
                  x={
                    width -
                    right +
                    56
                  }
                  y={
                    currentPriceY +
                    6
                  }
                  textAnchor="middle"
                  className="lex-current-price-text"
                >
                  {formatChartPrice(
                    effectivePrice,
                  )}
                </text>
              </>
            )}
        </svg>

        {loading && (
          <div className="lex-chart-refreshing">
            Updating…
          </div>
        )}
      </div>
    );
  },
);

/* =========================================================
   VOLUME CHART
   ========================================================= */

const VolumePanel = memo(
  function VolumePanel({
    candles,
  }: {
    candles: NormalizedCandle[];
  }) {
    const data =
      useMemo(
        () =>
          candles.slice(
            -120,
          ),
        [candles],
      );

    const maxVolume =
      useMemo(
        () =>
          Math.max(
            0,
            ...data.map(
              (candle) =>
                candle.volume,
            ),
          ),
        [data],
      );

    if (
      data.length === 0
    ) {
      return (
        <section className="lex-chart-module lex-volume-module">
          <div className="lex-module-header">
            <div>
              <BarChart3
                size={15}
                strokeWidth={1.6}
              />

              <span>
                VOLUME
              </span>
            </div>

            <span className="lex-module-state">
              GATE.IO OHLCV
            </span>
          </div>

          <div className="lex-volume-empty">
            <span>
              Waiting for candle volume
            </span>
          </div>
        </section>
      );
    }

    return (
      <section className="lex-chart-module lex-volume-module">
        <div className="lex-module-header">
          <div>
            <BarChart3
              size={15}
              strokeWidth={1.6}
            />

            <span>
              VOLUME
            </span>
          </div>

          <span className="lex-module-state">
            GATE.IO OHLCV
          </span>
        </div>

        <div className="lex-volume-chart">
          {data.map(
            (
              candle,
              index,
            ) => {
              const height =
                maxVolume > 0
                  ? Math.max(
                      2,
                      (candle.volume /
                        maxVolume) *
                        100,
                    )
                  : 2;

              const bullish =
                candle.close >=
                candle.open;

              return (
                <span
                  key={`${candle.timestamp}-${index}`}
                  className={`lex-volume-bar ${
                    bullish
                      ? 'bullish'
                      : 'bearish'
                  }`}
                  style={
                    {
                      '--volume-height':
                        `${height}%`,
                    } as CSSProperties
                  }
                  title={formatCompact(
                    candle.volume,
                  )}
                />
              );
            },
          )}
        </div>
      </section>
    );
  },
);

/* =========================================================
   LIQUIDITY HEATMAP

   We intentionally do not invent historical depth.
   ========================================================= */

function LiquidityHeatmap() {
  return (
    <section className="lex-chart-module lex-heatmap-module">
      <div className="lex-module-header">
        <div>
          <Layers3
            size={15}
            strokeWidth={1.6}
          />

          <span>
            LIQUIDITY HEATMAP
          </span>
        </div>

        <span className="lex-module-state">
          DEPTH ENGINE NEXT
        </span>
      </div>

      <div className="lex-heatmap-empty">
        <div className="lex-heatmap-grid" />

        <span>
          Waiting for historical depth mapping
        </span>
      </div>
    </section>
  );
}

/* =========================================================
   SIMPLE REAL OHLCV ANALYSIS

   This section uses only available candle data.
   Order flow and liquidity remain empty until their actual
   data engines are connected.
   ========================================================= */

function calculateTrend(
  candles: NormalizedCandle[],
) {
  if (
    candles.length <
    20
  ) {
    return null;
  }

  const recent =
    candles.slice(-20);

  const first =
    recent[0].close;

  const last =
    recent[
      recent.length -
        1
    ].close;

  if (
    !first ||
    !last
  ) {
    return null;
  }

  return (
    ((last - first) /
      first) *
    100
  );
}

function calculateMomentum(
  candles: NormalizedCandle[],
) {
  if (
    candles.length <
    10
  ) {
    return null;
  }

  const recent =
    candles.slice(-10);

  let gains =
    0;

  let losses =
    0;

  for (
    let index = 1;
    index <
    recent.length;
    index += 1
  ) {
    const delta =
      recent[index].close -
      recent[index - 1]
        .close;

    if (
      delta >= 0
    ) {
      gains += delta;
    } else {
      losses +=
        Math.abs(delta);
    }
  }

  const total =
    gains +
    losses;

  if (
    total === 0
  ) {
    return 0;
  }

  return (
    ((gains -
      losses) /
      total) *
    100
  );
}

function calculateVolumeDelta(
  candles: NormalizedCandle[],
) {
  if (
    candles.length ===
    0
  ) {
    return null;
  }

  const recent =
    candles.slice(-20);

  let bullish =
    0;

  let bearish =
    0;

  recent.forEach(
    (candle) => {
      if (
        candle.close >=
        candle.open
      ) {
        bullish +=
          candle.volume;
      } else {
        bearish +=
          candle.volume;
      }
    },
  );

  const total =
    bullish +
    bearish;

  if (
    total === 0
  ) {
    return 0;
  }

  return (
    ((bullish -
      bearish) /
      total) *
    100
  );
}

function calculateStructure(
  candles: NormalizedCandle[],
) {
  if (
    candles.length <
    6
  ) {
    return null;
  }

  const recent =
    candles.slice(-6);

  let score =
    0;

  for (
    let index = 1;
    index <
    recent.length;
    index += 1
  ) {
    const current =
      recent[index];

    const previous =
      recent[index - 1];

    if (
      current.high >
        previous.high &&
      current.low >
        previous.low
    ) {
      score += 1;
    }

    if (
      current.high <
        previous.high &&
      current.low <
        previous.low
    ) {
      score -= 1;
    }
  }

  return (
    (score /
      (recent.length -
        1)) *
    100
  );
}

function scoreLabel(
  value: number | null,
) {
  if (
    value === null
  ) {
    return '—';
  }

  if (
    value > 10
  ) {
    return `+${value.toFixed(
      0,
    )}`;
  }

  return value.toFixed(
    0,
  );
}

function scoreClass(
  value: number | null,
) {
  if (
    value === null
  ) {
    return '';
  }

  if (
    value > 10
  ) {
    return 'positive';
  }

  if (
    value < -10
  ) {
    return 'negative';
  }

  return 'neutral';
}

/* =========================================================
   LEX ENGINE STRIP
   ========================================================= */

function LexEngineStrip({
  candles,
}: {
  candles: NormalizedCandle[];
}) {
  const metrics =
    useMemo(
      () => ({
        trend:
          calculateTrend(
            candles,
          ),

        momentum:
          calculateMomentum(
            candles,
          ),

        volume:
          calculateVolumeDelta(
            candles,
          ),

        structure:
          calculateStructure(
            candles,
          ),
      }),
      [candles],
    );

  return (
    <section className="lex-engine-strip">
      <div className="lex-engine-heading">
        <div>
          <Activity
            size={15}
            strokeWidth={1.7}
          />

          <span>
            LEX V2.4.1 F
          </span>
        </div>

        <span className="lex-engine-status">
          OHLCV ACTIVE
        </span>
      </div>

      <div className="lex-engine-grid">
        <div
          className={`lex-engine-cell ${scoreClass(
            metrics.trend,
          )}`}
        >
          <span>
            TREND
          </span>

          <strong>
            {scoreLabel(
              metrics.trend,
            )}
          </strong>
        </div>

        <div
          className={`lex-engine-cell ${scoreClass(
            metrics.momentum,
          )}`}
        >
          <span>
            MOMENTUM
          </span>

          <strong>
            {scoreLabel(
              metrics.momentum,
            )}
          </strong>
        </div>

        <div
          className={`lex-engine-cell ${scoreClass(
            metrics.volume,
          )}`}
        >
          <span>
            VOLUME / DELTA
          </span>

          <strong>
            {scoreLabel(
              metrics.volume,
            )}
          </strong>
        </div>

        <div
          className={`lex-engine-cell ${scoreClass(
            metrics.structure,
          )}`}
        >
          <span>
            STRUCTURE
          </span>

          <strong>
            {scoreLabel(
              metrics.structure,
            )}
          </strong>
        </div>

        <div className="lex-engine-cell">
          <span>
            ORDER FLOW
          </span>

          <strong>
            —
          </strong>
        </div>

        <div className="lex-engine-cell">
          <span>
            LIQUIDITY
          </span>

          <strong>
            —
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   MAIN COMPONENT
   ========================================================= */

export default function LexChart({
  baseAsset,
  quoteAsset,
  lastPrice,
  priceChangePercent,
  candles,
  timeframe,
  onTimeframeChange,
  loading = false,
}: LexChartProps) {
  const [
    expanded,
    setExpanded,
  ] = useState(false);

  const chartRef =
    useRef<HTMLElement>(
      null,
    );

  const normalizedCandles =
    useMemo(
      () =>
        normalizeCandles(
          candles,
        ),
      [candles],
    );

  const positive =
    priceChangePercent !==
      null &&
    priceChangePercent >=
      0;

  /* =======================================================
     EXPAND / FULLSCREEN
     ======================================================= */

  const toggleExpanded =
    async () => {
      const element =
        chartRef.current;

      if (!element) {
        return;
      }

      try {
        if (
          document.fullscreenElement
        ) {
          await document.exitFullscreen();

          setExpanded(false);

          return;
        }

        if (
          element.requestFullscreen
        ) {
          await element.requestFullscreen();

          setExpanded(true);

          return;
        }

        /*
         * iOS Safari may not expose fullscreen for arbitrary
         * elements. CSS expanded mode remains the fallback.
         */
        setExpanded(
          (value) =>
            !value,
        );
      } catch {
        setExpanded(
          (value) =>
            !value,
        );
      }
    };

  useEffect(() => {
    const handleFullscreen =
      () => {
        setExpanded(
          document.fullscreenElement ===
            chartRef.current,
        );
      };

    document.addEventListener(
      'fullscreenchange',
      handleFullscreen,
    );

    return () => {
      document.removeEventListener(
        'fullscreenchange',
        handleFullscreen,
      );
    };
  }, []);

  return (
    <section
      ref={chartRef}
      className={`lex-chart-screen${
        expanded
          ? ' expanded'
          : ''
      }`}
      aria-label="LEX chart"
    >
      {/* =================================================
          TOP
          ================================================= */}

      <div className="lex-chart-top">
        <div className="lex-chart-market">
          <div className="lex-chart-pair">
            <strong>
              {baseAsset}
            </strong>

            <span>
              / {quoteAsset}
            </span>
          </div>

          <div className="lex-chart-price-row">
            <strong className="lex-chart-last-price">
              {formatChartPrice(
                lastPrice,
              )}
            </strong>

            {priceChangePercent !==
              null && (
              <span
                className={
                  positive
                    ? 'lex-chart-change positive'
                    : 'lex-chart-change negative'
                }
              >
                {positive
                  ? '+'
                  : ''}

                {priceChangePercent.toFixed(
                  2,
                )}
                %
              </span>
            )}
          </div>

          <div className="lex-chart-meta">
            <span>
              {timeframeLabel(
                timeframe,
              )}
            </span>

            <span>
              ·
            </span>

            <span>
              {loading
                ? 'UPDATING'
                : `${normalizedCandles.length} REAL CANDLES`}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="lex-chart-expand"
          aria-label={
            expanded
              ? 'Close expanded chart'
              : 'Expand chart'
          }
          onClick={
            toggleExpanded
          }
        >
          {expanded ? (
            <Minimize2
              size={18}
              strokeWidth={1.7}
            />
          ) : (
            <Maximize2
              size={18}
              strokeWidth={1.7}
            />
          )}
        </button>
      </div>

      {/* =================================================
          ONE TIMEFRAME SELECTOR
          ================================================= */}

      <TimeframeSelector
        value={
          timeframe
        }
        onChange={
          onTimeframeChange
        }
      />

      {/* =================================================
          REAL OHLCV CHART
          ================================================= */}

      <RealCandleChart
        candles={
          normalizedCandles
        }
        lastPrice={
          lastPrice
        }
        loading={
          loading
        }
      />

      {/* =================================================
          REAL VOLUME
          ================================================= */}

      <VolumePanel
        candles={
          normalizedCandles
        }
      />

      {/* =================================================
          HEATMAP PLACEHOLDER
          ================================================= */}

      <LiquidityHeatmap />

      {/* =================================================
          LEX OHLCV ENGINE
          ================================================= */}

      <LexEngineStrip
        candles={
          normalizedCandles
        }
      />
    </section>
  );
}