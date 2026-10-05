import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Activity,
  BarChart3,
  CandlestickChart,
  Crosshair,
  Layers3,
  Maximize2,
  Minimize2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import type {
  GateCandle,
  GateTimeframe,
} from '@/hooks/use-gate-candles';

/* =========================================================
   LEX V2.4.2 FINAL
   src/components/LexChart.tsx

   ENGINE WEIGHTS

   Trend              25
   Momentum           15
   Volume / Delta     15
   Structure          15
   Order Flow         20
   Liquidity          10

   TOTAL             100

   LEVEL-2 / HEATMAP:
   - Real Gate.io Level-2
   - Multi-depth OBI
   - Order flow
   - Liquidity pressure
   - Historical liquidity heatmap
   - Wall persistence
   - Wall approach / retreat
   - Liquidity growth / removal
   - Absorption proxy
   - Spoof-risk
   - Data-quality filter

   NO SYNTHETIC LEVEL-2 DATA
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

export type LexDepthMetric = {
  depthPercent: number;

  bidVolume: number;
  askVolume: number;

  obi: number;
};

export type LexHeatmapLevel = {
  price: number;

  size: number;

  side:
    | 'bid'
    | 'ask';

  intensity: number;

  ageMs: number;

  persistence: number;

  isWall: boolean;
};

export type LexHeatmapSnapshot = {
  timestamp: number;

  midPrice:
    number | null;

  levels:
    LexHeatmapLevel[];
};

export type LexOrderBookMetrics = {
  obi?: number | null;

  orderFlow?: number | null;

  liquidityPressure?:
    number | null;

  bidVolume?: number | null;
  askVolume?: number | null;

  bidWallPrice?: number | null;
  askWallPrice?: number | null;

  bidWallSize?: number | null;
  askWallSize?: number | null;

  spread?: number | null;

  microPrice?: number | null;

  absorption?: number | null;

  replenishment?: number | null;

  spoofRisk?: number | null;

  updatedAt?: number | null;

  multiDepth?: LexDepthMetric[];

  obi01?: number | null;
  obi025?: number | null;
  obi05?: number | null;
  obi1?: number | null;
  obi2?: number | null;

  bidAdd?: number | null;
  askAdd?: number | null;

  bidPull?: number | null;
  askPull?: number | null;

  bidPersistence?: number | null;
  askPersistence?: number | null;

  bidWallAgeMs?: number | null;
  askWallAgeMs?: number | null;

  bidWallDistancePercent?:
    number | null;

  askWallDistancePercent?:
    number | null;

  microPriceBias?: number | null;

  spreadPercent?: number | null;

  heatmap?: LexHeatmapSnapshot[];

  dataQuality?: number | null;
};

export type LexChartProps = {
  baseAsset: string;

  quoteAsset: string;

  pair: string;

  lastPrice:
    number | null;

  priceChangePercent:
    number | null;

  candles:
    GateCandle[];

  timeframe:
    GateTimeframe;

  onTimeframeChange?: (
    timeframe: GateTimeframe,
  ) => void;

  orderBookMetrics?:
    LexOrderBookMetrics | null;

  orderBookBids?:
    LexOrderBookLevel[];

  orderBookAsks?:
    LexOrderBookLevel[];

  /*
   * FIX V2.4.2
   *
   * Real historical Level-2 heatmap from
   * useGateOrderBook().
   */

  orderBookHeatmap?:
    LexHeatmapSnapshot[];

  candlesLoading?: boolean;

  candlesError?:
    string | null;
};

type SignalDirection =
  | 'LONG'
  | 'SHORT'
  | 'WAIT';

type Regime =
  | 'EXPANSION'
  | 'COMPRESSION'
  | 'NORMAL';

type Sweep =
  | 'BULL SWEEP'
  | 'BEAR SWEEP'
  | 'NONE';

type LexMetrics = {
  trend: number;

  momentum: number;

  volumeDelta: number;

  structure: number;

  orderFlow:
    number | null;

  liquidity:
    number | null;

  candleScore: number;

  score:
    number | null;

  bull: number;

  neutral: number;

  bear: number;

  signal:
    SignalDirection;

  confidence: number;

  confirmations: number;

  availableWeight: number;

  regime:
    Regime;

  ema9:
    number | null;

  ema21:
    number | null;

  ema50:
    number | null;

  ema100:
    number | null;

  rsi:
    number | null;

  macd:
    number | null;

  macdSignal:
    number | null;

  macdHistogram:
    number | null;

  atr:
    number | null;

  avgVolume:
    number | null;

  currentVolume:
    number | null;

  support:
    number | null;

  resistance:
    number | null;

  entryLow:
    number | null;

  entryHigh:
    number | null;

  stopLoss:
    number | null;

  tp1:
    number | null;

  tp2:
    number | null;

  tp3:
    number | null;

  invalidation:
    number | null;

  sweep:
    Sweep;

  obi:
    number | null;

  bidVolume:
    number | null;

  askVolume:
    number | null;

  bidWallPrice:
    number | null;

  askWallPrice:
    number | null;

  spread:
    number | null;

  microPrice:
    number | null;

  spoofRisk:
    number | null;

  level2Available:
    boolean;

  /* HEATMAP ANALYZER */

  heatmapScore:
    number | null;

  heatmapSnapshots: number;

  heatmapBidPressure: number;

  heatmapAskPressure: number;

  heatmapBidApproach: number;

  heatmapAskApproach: number;

  heatmapBidGrowth: number;

  heatmapAskGrowth: number;

  heatmapBidRemoval: number;

  heatmapAskRemoval: number;

  heatmapBidPersistence: number;

  heatmapAskPersistence: number;

  heatmapBidAbsorption: number;

  heatmapAskAbsorption: number;

  dataQuality: number;
};

type ChartLayers = {
  lex: boolean;

  heatmap: boolean;

  ema: boolean;

  levels: boolean;
};

type HeatmapLevel = {
  side:
    | 'bid'
    | 'ask';

  price: number;

  size: number;

  intensity: number;

  ageMs: number;

  persistent: boolean;

  large: boolean;
};

type HeatmapAnalysis = {
  score:
    number | null;

  snapshots: number;

  bidPressure: number;

  askPressure: number;

  bidApproach: number;

  askApproach: number;

  bidGrowth: number;

  askGrowth: number;

  bidRemoval: number;

  askRemoval: number;

  bidPersistence: number;

  askPersistence: number;

  bidAbsorption: number;

  askAbsorption: number;
};

/* =========================================================
   CONSTANTS
   ========================================================= */

const TIMEFRAMES:
  GateTimeframe[] = [
    '1m',
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
  ];

const TREND_WEIGHT = 25;

const MOMENTUM_WEIGHT = 15;

const VOLUME_WEIGHT = 15;

const STRUCTURE_WEIGHT = 15;

const ORDER_FLOW_WEIGHT = 20;

const LIQUIDITY_WEIGHT = 10;

const CANDLE_WEIGHT =
  TREND_WEIGHT +
  MOMENTUM_WEIGHT +
  VOLUME_WEIGHT +
  STRUCTURE_WEIGHT;

const FULL_WEIGHT =
  CANDLE_WEIGHT +
  ORDER_FLOW_WEIGHT +
  LIQUIDITY_WEIGHT;

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  );
}

function average(
  values: number[],
): number {
  if (
    values.length === 0
  ) {
    return 0;
  }

  return (
    values.reduce(
      (
        sum,
        value,
      ) =>
        sum + value,
      0,
    ) /
    values.length
  );
}

function safeNumber(
  value:
    | number
    | null
    | undefined,
): number | null {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value,
    )
  ) {
    return null;
  }

  return value;
}

function timestampToChartTime(
  timestamp: number,
): Time {
  const seconds =
    timestamp >
    10_000_000_000
      ? Math.floor(
          timestamp / 1000,
        )
      : Math.floor(
          timestamp,
        );

  return seconds as Time;
}

function formatPrice(
  value:
    number | null,
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
    Math.abs(value);

  let digits = 2;

  if (absolute < 1000) {
    digits = 3;
  }

  if (absolute < 100) {
    digits = 4;
  }

  if (absolute < 1) {
    digits = 6;
  }

  if (absolute < 0.01) {
    digits = 8;
  }

  return value.toLocaleString(
    'en-US',
    {
      maximumFractionDigits:
        digits,

      minimumFractionDigits:
        Math.min(
          2,
          digits,
        ),
    },
  );
}

function formatCompact(
  value:
    number | null,
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
    Math.abs(value);

  if (
    absolute >=
    1_000_000_000
  ) {
    return `${(
      value /
      1_000_000_000
    ).toFixed(2)}B`;
  }

  if (
    absolute >=
    1_000_000
  ) {
    return `${(
      value /
      1_000_000
    ).toFixed(2)}M`;
  }

  if (
    absolute >=
    1000
  ) {
    return `${(
      value /
      1000
    ).toFixed(1)}K`;
  }

  return value.toFixed(
    2,
  );
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
   EMA
   ========================================================= */

function emaSeries(
  values: number[],
  period: number,
): number[] {
  if (
    values.length === 0
  ) {
    return [];
  }

  const multiplier =
    2 /
    (
      period + 1
    );

  const result:
    number[] = [];

  let previous =
    values[0];

  result.push(
    previous,
  );

  for (
    let index = 1;
    index <
    values.length;
    index += 1
  ) {
    const current =
      values[index];

    previous =
      current *
        multiplier +
      previous *
        (
          1 -
          multiplier
        );

    result.push(
      previous,
    );
  }

  return result;
}

function lastEma(
  values: number[],
  period: number,
): number | null {
  if (
    values.length <
    period
  ) {
    return null;
  }

  const series =
    emaSeries(
      values,
      period,
    );

  return (
    series[
      series.length - 1
    ] ?? null
  );
}

/* =========================================================
   RSI
   ========================================================= */

function calculateRSI(
  values: number[],
  period = 14,
): number | null {
  if (
    values.length <=
    period
  ) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (
    let index = 1;
    index <= period;
    index += 1
  ) {
    const difference =
      values[index] -
      values[index - 1];

    if (
      difference >= 0
    ) {
      gain +=
        difference;
    } else {
      loss +=
        Math.abs(
          difference,
        );
    }
  }

  let averageGain =
    gain /
    period;

  let averageLoss =
    loss /
    period;

  for (
    let index =
      period + 1;
    index <
    values.length;
    index += 1
  ) {
    const difference =
      values[index] -
      values[index - 1];

    const currentGain =
      difference > 0
        ? difference
        : 0;

    const currentLoss =
      difference < 0
        ? Math.abs(
            difference,
          )
        : 0;

    averageGain =
      (
        averageGain *
          (
            period - 1
          ) +
        currentGain
      ) /
      period;

    averageLoss =
      (
        averageLoss *
          (
            period - 1
          ) +
        currentLoss
      ) /
      period;
  }

  if (
    averageLoss === 0
  ) {
    return 100;
  }

  const rs =
    averageGain /
    averageLoss;

  return (
    100 -
    100 /
      (
        1 + rs
      )
  );
}

/* =========================================================
   MACD
   ========================================================= */

function calculateMACD(
  values: number[],
) {
  if (
    values.length < 35
  ) {
    return {
      macd: null,
      signal: null,
      histogram: null,
    };
  }

  const fast =
    emaSeries(
      values,
      12,
    );

  const slow =
    emaSeries(
      values,
      26,
    );

  const macdSeries =
    values.map(
      (
        _value,
        index,
      ) =>
        fast[index] -
        slow[index],
    );

  const signalSeries =
    emaSeries(
      macdSeries,
      9,
    );

  const macd =
    macdSeries[
      macdSeries.length -
        1
    ];

  const signal =
    signalSeries[
      signalSeries.length -
        1
    ];

  return {
    macd,

    signal,

    histogram:
      macd -
      signal,
  };
}

/* =========================================================
   ATR
   ========================================================= */

function calculateATR(
  candles:
    GateCandle[],
  period = 14,
): number | null {
  if (
    candles.length <=
    period
  ) {
    return null;
  }

  const trueRanges:
    number[] = [];

  for (
    let index = 1;
    index <
    candles.length;
    index += 1
  ) {
    const current =
      candles[index];

    const previous =
      candles[
        index - 1
      ];

    trueRanges.push(
      Math.max(
        current.high -
          current.low,

        Math.abs(
          current.high -
            previous.close,
        ),

        Math.abs(
          current.low -
            previous.close,
        ),
      ),
    );
  }

  if (
    trueRanges.length <
    period
  ) {
    return null;
  }

  let atr =
    average(
      trueRanges.slice(
        0,
        period,
      ),
    );

  for (
    let index =
      period;
    index <
    trueRanges.length;
    index += 1
  ) {
    atr =
      (
        atr *
          (
            period - 1
          ) +
        trueRanges[index]
      ) /
      period;
  }

  return atr;
}

/* =========================================================
   LEVEL-2 NORMALIZATION
   ========================================================= */

function normalizeOrderFlow(
  metrics:
    LexOrderBookMetrics |
    null |
    undefined,
): number | null {
  if (!metrics) {
    return null;
  }

  const direct =
    safeNumber(
      metrics.orderFlow,
    );

  if (
    direct !== null
  ) {
    return clamp(
      direct,
      -1,
      1,
    );
  }

  const obi =
    safeNumber(
      metrics.obi,
    );

  if (
    obi !== null
  ) {
    return clamp(
      obi,
      -1,
      1,
    );
  }

  const bidVolume =
    safeNumber(
      metrics.bidVolume,
    );

  const askVolume =
    safeNumber(
      metrics.askVolume,
    );

  if (
    bidVolume !== null &&
    askVolume !== null
  ) {
    const total =
      bidVolume +
      askVolume;

    if (
      total > 0
    ) {
      return clamp(
        (
          bidVolume -
          askVolume
        ) /
          total,
        -1,
        1,
      );
    }
  }

  return null;
}

function normalizeLiquidityPressure(
  metrics:
    LexOrderBookMetrics |
    null |
    undefined,
): number | null {
  if (!metrics) {
    return null;
  }

  const direct =
    safeNumber(
      metrics.liquidityPressure,
    );

  if (
    direct !== null
  ) {
    return clamp(
      direct,
      -1,
      1,
    );
  }

  const bidWall =
    safeNumber(
      metrics.bidWallSize,
    );

  const askWall =
    safeNumber(
      metrics.askWallSize,
    );

  if (
    bidWall !== null &&
    askWall !== null
  ) {
    const total =
      bidWall +
      askWall;

    if (
      total > 0
    ) {
      return clamp(
        (
          bidWall -
          askWall
        ) /
          total,
        -1,
        1,
      );
    }
  }

  return null;
}

/* =========================================================
   HISTORICAL HEATMAP ANALYZER
   ========================================================= */

function emptyHeatmapAnalysis():
  HeatmapAnalysis {
  return {
    score: null,

    snapshots: 0,

    bidPressure: 0,
    askPressure: 0,

    bidApproach: 0,
    askApproach: 0,

    bidGrowth: 0,
    askGrowth: 0,

    bidRemoval: 0,
    askRemoval: 0,

    bidPersistence: 0,
    askPersistence: 0,

    bidAbsorption: 0,
    askAbsorption: 0,
  };
}

function sideLiquidity(
  snapshot:
    LexHeatmapSnapshot,

  side:
    | 'bid'
    | 'ask',
): number {
  return snapshot.levels
    .filter(
      (level) =>
        level.side ===
        side,
    )
    .reduce(
      (
        sum,
        level,
      ) => {
        const persistence =
          clamp(
            level.persistence,
            0,
            1,
          );

        const wallBonus =
          level.isWall
            ? 1.15
            : 1;

        return (
          sum +
          level.size *
            (
              0.5 +
              persistence *
                0.5
            ) *
            wallBonus
        );
      },
      0,
    );
}

function weightedDistance(
  snapshot:
    LexHeatmapSnapshot,

  side:
    | 'bid'
    | 'ask',
): number | null {
  if (
    snapshot.midPrice ===
      null ||
    !Number.isFinite(
      snapshot.midPrice,
    ) ||
    snapshot.midPrice <=
      0
  ) {
    return null;
  }

  const levels =
    snapshot.levels.filter(
      (level) =>
        level.side ===
          side &&
        Number.isFinite(
          level.price,
        ) &&
        Number.isFinite(
          level.size,
        ) &&
        level.price > 0 &&
        level.size > 0,
    );

  if (
    levels.length === 0
  ) {
    return null;
  }

  let totalWeight = 0;

  let weightedDistanceSum =
    0;

  for (
    const level of levels
  ) {
    const persistence =
      clamp(
        level.persistence,
        0,
        1,
      );

    const weight =
      level.size *
      (
        0.5 +
        persistence *
          0.5
      ) *
      (
        level.isWall
          ? 1.15
          : 1
      );

    const distance =
      Math.abs(
        level.price -
          snapshot.midPrice,
      ) /
      snapshot.midPrice;

    totalWeight +=
      weight;

    weightedDistanceSum +=
      distance *
      weight;
  }

  if (
    totalWeight <= 0
  ) {
    return null;
  }

  return (
    weightedDistanceSum /
    totalWeight
  );
}

function pricesMatch(
  first: number,
  second: number,
): boolean {
  if (
    first <= 0 ||
    second <= 0
  ) {
    return false;
  }

  const difference =
    Math.abs(
      first -
      second,
    );

  const reference =
    Math.max(
      Math.abs(
        first,
      ),
      Math.abs(
        second,
      ),
    );

  return (
    difference /
      reference <=
    0.000001
  );
}

function calculateRemoval(
  previous:
    LexHeatmapSnapshot,

  current:
    LexHeatmapSnapshot,

  side:
    | 'bid'
    | 'ask',
): number {
  const previousLevels =
    previous.levels.filter(
      (level) =>
        level.side ===
          side &&
        level.size > 0,
    );

  const currentLevels =
    current.levels.filter(
      (level) =>
        level.side ===
          side &&
        level.size > 0,
    );

  if (
    previousLevels.length ===
    0
  ) {
    return 0;
  }

  let previousLiquidity =
    0;

  let removedLiquidity =
    0;

  for (
    const previousLevel of
      previousLevels
  ) {
    previousLiquidity +=
      previousLevel.size;

    const currentLevel =
      currentLevels.find(
        (level) =>
          pricesMatch(
            level.price,
            previousLevel.price,
          ),
      );

    if (
      !currentLevel
    ) {
      removedLiquidity +=
        previousLevel.size;

      continue;
    }

    if (
      currentLevel.size <
      previousLevel.size
    ) {
      removedLiquidity +=
        previousLevel.size -
        currentLevel.size;
    }
  }

  if (
    previousLiquidity <=
    0
  ) {
    return 0;
  }

  return clamp(
    removedLiquidity /
      previousLiquidity,
    0,
    1,
  );
}

function calculateSidePersistence(
  snapshot:
    LexHeatmapSnapshot,

  side:
    | 'bid'
    | 'ask',
): number {
  const levels =
    snapshot.levels.filter(
      (level) =>
        level.side ===
          side &&
        level.size > 0,
    );

  if (
    levels.length === 0
  ) {
    return 0;
  }

  const totalSize =
    levels.reduce(
      (
        sum,
        level,
      ) =>
        sum +
        level.size,
      0,
    );

  if (
    totalSize <= 0
  ) {
    return 0;
  }

  const weighted =
    levels.reduce(
      (
        sum,
        level,
      ) =>
        sum +
        clamp(
          level.persistence,
          0,
          1,
        ) *
          level.size,
      0,
    );

  return clamp(
    weighted /
      totalSize,
    0,
    1,
  );
}

function calculateHeatmapAnalysis(
  history:
    LexHeatmapSnapshot[],
): HeatmapAnalysis {
  const valid =
    history
      .filter(
        (snapshot) =>
          Number.isFinite(
            snapshot.timestamp,
          ) &&
          snapshot.levels.length >
            0,
      )
      .sort(
        (
          a,
          b,
        ) =>
          a.timestamp -
          b.timestamp,
      )
      .slice(-60);

  if (
    valid.length < 2
  ) {
    return {
      ...emptyHeatmapAnalysis(),

      snapshots:
        valid.length,
    };
  }

  const current =
    valid[
      valid.length - 1
    ];

  const previous =
    valid[
      valid.length - 2
    ];

  if (
    !current ||
    !previous
  ) {
    return emptyHeatmapAnalysis();
  }

  const currentBid =
    sideLiquidity(
      current,
      'bid',
    );

  const currentAsk =
    sideLiquidity(
      current,
      'ask',
    );

  const previousBid =
    sideLiquidity(
      previous,
      'bid',
    );

  const previousAsk =
    sideLiquidity(
      previous,
      'ask',
    );

  const currentTotal =
    currentBid +
    currentAsk;

  const bidPressure =
    currentTotal > 0
      ? currentBid /
        currentTotal
      : 0;

  const askPressure =
    currentTotal > 0
      ? currentAsk /
        currentTotal
      : 0;

  const bidGrowth =
    previousBid > 0
      ? clamp(
          (
            currentBid -
            previousBid
          ) /
            previousBid,
          -1,
          1,
        )
      : 0;

  const askGrowth =
    previousAsk > 0
      ? clamp(
          (
            currentAsk -
            previousAsk
          ) /
            previousAsk,
          -1,
          1,
        )
      : 0;

  const previousBidDistance =
    weightedDistance(
      previous,
      'bid',
    );

  const currentBidDistance =
    weightedDistance(
      current,
      'bid',
    );

  const previousAskDistance =
    weightedDistance(
      previous,
      'ask',
    );

  const currentAskDistance =
    weightedDistance(
      current,
      'ask',
    );

  const bidApproach =
    previousBidDistance !==
      null &&
    currentBidDistance !==
      null &&
    previousBidDistance > 0
      ? clamp(
          (
            previousBidDistance -
            currentBidDistance
          ) /
            previousBidDistance,
          -1,
          1,
        )
      : 0;

  const askApproach =
    previousAskDistance !==
      null &&
    currentAskDistance !==
      null &&
    previousAskDistance > 0
      ? clamp(
          (
            previousAskDistance -
            currentAskDistance
          ) /
            previousAskDistance,
          -1,
          1,
        )
      : 0;

  const bidRemoval =
    calculateRemoval(
      previous,
      current,
      'bid',
    );

  const askRemoval =
    calculateRemoval(
      previous,
      current,
      'ask',
    );

  const bidPersistence =
    calculateSidePersistence(
      current,
      'bid',
    );

  const askPersistence =
    calculateSidePersistence(
      current,
      'ask',
    );

  const bidAbsorption =
    clamp(
      bidPersistence *
        bidPressure *
        (
          1 -
          bidRemoval
        ),
      0,
      1,
    );

  const askAbsorption =
    clamp(
      askPersistence *
        askPressure *
        (
          1 -
          askRemoval
        ),
      0,
      1,
    );

  const pressureBias =
    bidPressure -
    askPressure;

  const growthBias =
    bidGrowth -
    askGrowth;

  const approachBias =
    bidApproach -
    askApproach;

  const removalBias =
    askRemoval -
    bidRemoval;

  const persistenceBias =
    bidPersistence -
    askPersistence;

  const absorptionBias =
    bidAbsorption -
    askAbsorption;

  const score =
    clamp(
      pressureBias *
        0.30 +
      growthBias *
        0.15 +
      approachBias *
        0.15 +
      removalBias *
        0.10 +
      persistenceBias *
        0.15 +
      absorptionBias *
        0.15,
      -1,
      1,
    );

  return {
    score,

    snapshots:
      valid.length,

    bidPressure,

    askPressure,

    bidApproach,

    askApproach,

    bidGrowth,

    askGrowth,

    bidRemoval,

    askRemoval,

    bidPersistence,

    askPersistence,

    bidAbsorption,

    askAbsorption,
  };
}

/* =========================================================
   PROBABILITY
   ========================================================= */

function calculateProbabilities(
  score: number,
) {
  const normalized =
    clamp(
      score / 100,
      -1,
      1,
    );

  const strength =
    Math.abs(
      normalized,
    );

  const neutral =
    clamp(
      42 -
        strength *
          30,
      12,
      42,
    );

  const directional =
    100 -
    neutral;

  let bull =
    directional / 2;

  let bear =
    directional / 2;

  if (
    normalized > 0
  ) {
    const shift =
      normalized *
      directional *
      0.45;

    bull += shift;

    bear -= shift;
  }

  if (
    normalized < 0
  ) {
    const shift =
      Math.abs(
        normalized,
      ) *
      directional *
      0.45;

    bear += shift;

    bull -= shift;
  }

  const total =
    bull +
    neutral +
    bear;

  return {
    bull:
      (
        bull /
        total
      ) *
      100,

    neutral:
      (
        neutral /
        total
      ) *
      100,

    bear:
      (
        bear /
        total
      ) *
      100,
  };
}

/* =========================================================
   LEX V2.4.2 ENGINE
   ========================================================= */

function calculateLexMetrics(
  sourceCandles:
    GateCandle[],

  orderBookMetrics?:
    LexOrderBookMetrics | null,

  orderBookHeatmap:
    LexHeatmapSnapshot[] = [],
): LexMetrics {
  /*
   * FIX V2.4.2
   *
   * Use dedicated heatmap history passed from App.
   * Fallback to metrics.heatmap only for compatibility.
   */

  const heatmapHistory =
    orderBookHeatmap.length > 0
      ? orderBookHeatmap
      : orderBookMetrics?.heatmap ??
        [];

  const heatmapAnalysis =
    calculateHeatmapAnalysis(
      heatmapHistory,
    );

  const dataQuality =
    clamp(
      safeNumber(
        orderBookMetrics?.dataQuality,
      ) ?? 0,
      0,
      1,
    );

  const empty:
    LexMetrics = {
      trend: 0,

      momentum: 0,

      volumeDelta: 0,

      structure: 0,

      orderFlow: null,

      liquidity: null,

      candleScore: 0,

      score: null,

      bull: 33.3,

      neutral: 33.4,

      bear: 33.3,

      signal: 'WAIT',

      confidence: 0,

      confirmations: 0,

      availableWeight:
        CANDLE_WEIGHT,

      regime: 'NORMAL',

      ema9: null,

      ema21: null,

      ema50: null,

      ema100: null,

      rsi: null,

      macd: null,

      macdSignal: null,

      macdHistogram: null,

      atr: null,

      avgVolume: null,

      currentVolume: null,

      support: null,

      resistance: null,

      entryLow: null,

      entryHigh: null,

      stopLoss: null,

      tp1: null,

      tp2: null,

      tp3: null,

      invalidation: null,

      sweep: 'NONE',

      obi:
        safeNumber(
          orderBookMetrics?.obi,
        ),

      bidVolume:
        safeNumber(
          orderBookMetrics?.bidVolume,
        ),

      askVolume:
        safeNumber(
          orderBookMetrics?.askVolume,
        ),

      bidWallPrice:
        safeNumber(
          orderBookMetrics?.bidWallPrice,
        ),

      askWallPrice:
        safeNumber(
          orderBookMetrics?.askWallPrice,
        ),

      spread:
        safeNumber(
          orderBookMetrics?.spread,
        ),

      microPrice:
        safeNumber(
          orderBookMetrics?.microPrice,
        ),

      spoofRisk:
        safeNumber(
          orderBookMetrics?.spoofRisk,
        ),

      level2Available:
        false,

      heatmapScore:
        heatmapAnalysis.score,

      heatmapSnapshots:
        heatmapAnalysis.snapshots,

      heatmapBidPressure:
        heatmapAnalysis.bidPressure,

      heatmapAskPressure:
        heatmapAnalysis.askPressure,

      heatmapBidApproach:
        heatmapAnalysis.bidApproach,

      heatmapAskApproach:
        heatmapAnalysis.askApproach,

      heatmapBidGrowth:
        heatmapAnalysis.bidGrowth,

      heatmapAskGrowth:
        heatmapAnalysis.askGrowth,

      heatmapBidRemoval:
        heatmapAnalysis.bidRemoval,

      heatmapAskRemoval:
        heatmapAnalysis.askRemoval,

      heatmapBidPersistence:
        heatmapAnalysis.bidPersistence,

      heatmapAskPersistence:
        heatmapAnalysis.askPersistence,

      heatmapBidAbsorption:
        heatmapAnalysis.bidAbsorption,

      heatmapAskAbsorption:
        heatmapAnalysis.askAbsorption,

      dataQuality,
    };

  const candles =
    [...sourceCandles]
      .filter(
        (candle) =>
          Number.isFinite(
            candle.timestamp,
          ) &&
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
      )
      .sort(
        (
          a,
          b,
        ) =>
          a.timestamp -
          b.timestamp,
      );

  if (
    candles.length < 20
  ) {
    return empty;
  }

  const last =
    candles[
      candles.length - 1
    ];

  const closes =
    candles.map(
      (candle) =>
        candle.close,
    );

  const volumes =
    candles.map(
      (candle) =>
        candle.volume,
    );

  const currentPrice =
    last.close;

  const ema9 =
    lastEma(
      closes,
      9,
    );

  const ema21 =
    lastEma(
      closes,
      21,
    );

  const ema50 =
    lastEma(
      closes,
      50,
    );

  const ema100 =
    lastEma(
      closes,
      100,
    );

  const rsi =
    calculateRSI(
      closes,
      14,
    );

  const macd =
    calculateMACD(
      closes,
    );

  const atr =
    calculateATR(
      candles,
      14,
    );

  /* TREND */

  const trendSignals:
    number[] = [];

  if (
    ema9 !== null
  ) {
    trendSignals.push(
      currentPrice >=
      ema9
        ? 1
        : -1,
    );
  }

  if (
    ema9 !== null &&
    ema21 !== null
  ) {
    trendSignals.push(
      ema9 >= ema21
        ? 1
        : -1,
    );
  }

  if (
    ema21 !== null &&
    ema50 !== null
  ) {
    trendSignals.push(
      ema21 >= ema50
        ? 1
        : -1,
    );
  }

  if (
    ema50 !== null &&
    ema100 !== null
  ) {
    trendSignals.push(
      ema50 >= ema100
        ? 1
        : -1,
    );
  }

  const trend =
    clamp(
      trendSignals.length
        ? average(
            trendSignals,
          )
        : 0,
      -1,
      1,
    ) *
    TREND_WEIGHT;

  /* MOMENTUM */

  let momentumRaw = 0;

  let momentumWeight =
    0;

  if (
    rsi !== null
  ) {
    momentumRaw +=
      clamp(
        (
          rsi - 50
        ) /
          25,
        -1,
        1,
      ) *
      0.55;

    momentumWeight +=
      0.55;
  }

  if (
    macd.histogram !==
      null &&
    currentPrice > 0
  ) {
    momentumRaw +=
      clamp(
        (
          macd.histogram /
          currentPrice
        ) *
          1000,
        -1,
        1,
      ) *
      0.45;

    momentumWeight +=
      0.45;
  }

  if (
    momentumWeight > 0
  ) {
    momentumRaw /=
      momentumWeight;
  }

  const momentum =
    clamp(
      momentumRaw,
      -1,
      1,
    ) *
    MOMENTUM_WEIGHT;

  /* VOLUME / DELTA */

  const recentVolumes =
    volumes.slice(-20);

  const avgVolume =
    average(
      recentVolumes,
    );

  const currentVolume =
    last.volume;

  let signedVolume = 0;

  let totalVolume = 0;

  for (
    const candle of
      candles.slice(-14)
  ) {
    const range =
      Math.max(
        candle.high -
          candle.low,
        Number.EPSILON,
      );

    const bodyRatio =
      clamp(
        (
          candle.close -
          candle.open
        ) /
          range,
        -1,
        1,
      );

    signedVolume +=
      candle.volume *
      bodyRatio;

    totalVolume +=
      candle.volume;
  }

  const deltaRatio =
    totalVolume > 0
      ? signedVolume /
        totalVolume
      : 0;

  const volumeExpansion =
    avgVolume > 0
      ? currentVolume /
        avgVolume
      : 1;

  const volumeDelta =
    clamp(
      deltaRatio *
        clamp(
          volumeExpansion,
          0.5,
          1.5,
        ),
      -1,
      1,
    ) *
    VOLUME_WEIGHT;

  /* STRUCTURE */

  const structureWindow =
    candles.slice(
      -15,
      -1,
    );

  let support:
    number | null =
      null;

  let resistance:
    number | null =
      null;

  let structureRaw = 0;

  if (
    structureWindow.length >
    0
  ) {
    support =
      Math.min(
        ...structureWindow.map(
          (candle) =>
            candle.low,
        ),
      );

    resistance =
      Math.max(
        ...structureWindow.map(
          (candle) =>
            candle.high,
        ),
      );

    if (
      currentPrice >
      resistance
    ) {
      structureRaw = 1;
    } else if (
      currentPrice <
      support
    ) {
      structureRaw = -1;
    } else if (
      resistance >
      support
    ) {
      structureRaw =
        clamp(
          (
            (
              currentPrice -
              support
            ) /
              (
                resistance -
                support
              ) -
            0.5
          ) *
            2,
          -1,
          1,
        );
    }
  }

  const structure =
    structureRaw *
    STRUCTURE_WEIGHT;

  /* SWEEP */

  const liquidityWindow =
    candles.slice(
      -21,
      -1,
    );

  let sweep:
    Sweep =
      'NONE';

  if (
    liquidityWindow.length >
    0
  ) {
    const previousHigh =
      Math.max(
        ...liquidityWindow.map(
          (candle) =>
            candle.high,
        ),
      );

    const previousLow =
      Math.min(
        ...liquidityWindow.map(
          (candle) =>
            candle.low,
        ),
      );

    const range =
      Math.max(
        last.high -
          last.low,
        Number.EPSILON,
      );

    const upperWick =
      last.high -
      Math.max(
        last.open,
        last.close,
      );

    const lowerWick =
      Math.min(
        last.open,
        last.close,
      ) -
      last.low;

    if (
      last.low <
        previousLow &&
      last.close >
        previousLow &&
      lowerWick /
        range >=
        0.35
    ) {
      sweep =
        'BULL SWEEP';
    } else if (
      last.high >
        previousHigh &&
      last.close <
        previousHigh &&
      upperWick /
        range >=
        0.35
    ) {
      sweep =
        'BEAR SWEEP';
    }
  }

  /* LEVEL 2 */

  const rawOrderFlow =
    normalizeOrderFlow(
      orderBookMetrics,
    );

  let rawLiquidity =
    normalizeLiquidityPressure(
      orderBookMetrics,
    );

  /*
   * HEATMAP refines existing Liquidity weight.
   * It is not a seventh independent weight.
   */

  if (
    heatmapAnalysis.score !==
    null
  ) {
    if (
      rawLiquidity !==
      null
    ) {
      rawLiquidity =
        clamp(
          rawLiquidity *
            0.70 +
          heatmapAnalysis.score *
            0.30,
          -1,
          1,
        );
    } else {
      rawLiquidity =
        heatmapAnalysis.score;
    }
  }

  const orderFlow =
    rawOrderFlow ===
    null
      ? null
      : rawOrderFlow *
        ORDER_FLOW_WEIGHT;

  const liquidity =
    rawLiquidity ===
    null
      ? null
      : rawLiquidity *
        LIQUIDITY_WEIGHT;

  const level2Available =
    orderFlow !== null ||
    liquidity !== null;

  let availableWeight =
    CANDLE_WEIGHT;

  if (
    orderFlow !== null
  ) {
    availableWeight +=
      ORDER_FLOW_WEIGHT;
  }

  if (
    liquidity !== null
  ) {
    availableWeight +=
      LIQUIDITY_WEIGHT;
  }

  const candleScore =
    trend +
    momentum +
    volumeDelta +
    structure;

  let rawScore =
    candleScore;

  if (
    orderFlow !== null
  ) {
    rawScore +=
      orderFlow;
  }

  if (
    liquidity !== null
  ) {
    rawScore +=
      liquidity;
  }

  let score =
    availableWeight > 0
      ? clamp(
          (
            rawScore /
            availableWeight
          ) *
            FULL_WEIGHT,
          -100,
          100,
        )
      : null;

  if (
    score !== null &&
    level2Available &&
    dataQuality < 0.35
  ) {
    const candleOnly =
      clamp(
        (
          candleScore /
          CANDLE_WEIGHT
        ) *
          FULL_WEIGHT,
        -100,
        100,
      );

    score =
      score *
        dataQuality +
      candleOnly *
        (
          1 -
          dataQuality
        );
  }

  /* REGIME */

  let regime:
    Regime =
      'NORMAL';

  const recentAtr =
    calculateATR(
      candles.slice(-40),
      14,
    );

  const longAtr =
    calculateATR(
      candles.slice(-100),
      50,
    );

  if (
    recentAtr !== null &&
    longAtr !== null &&
    longAtr > 0
  ) {
    const ratio =
      recentAtr /
      longAtr;

    if (
      ratio >= 1.2
    ) {
      regime =
        'EXPANSION';
    } else if (
      ratio <= 0.8
    ) {
      regime =
        'COMPRESSION';
    }
  }

  /* SIGNAL */

  let signal:
    SignalDirection =
      'WAIT';

  if (
    score !== null
  ) {
    if (
      score >= 22
    ) {
      signal =
        'LONG';
    } else if (
      score <= -22
    ) {
      signal =
        'SHORT';
    }
  }

  /* CONFIRMATIONS */

  const components = [
    trend,
    momentum,
    volumeDelta,
    structure,
  ];

  if (
    orderFlow !== null
  ) {
    components.push(
      orderFlow,
    );
  }

  if (
    liquidity !== null
  ) {
    components.push(
      liquidity,
    );
  }

  const positiveConfirmations =
    components.filter(
      (value) =>
        value > 0,
    ).length;

  const negativeConfirmations =
    components.filter(
      (value) =>
        value < 0,
    ).length;

  const confirmations =
    signal === 'LONG'
      ? positiveConfirmations
      : signal ===
          'SHORT'
        ? negativeConfirmations
        : Math.max(
            positiveConfirmations,
            negativeConfirmations,
          );

  let confidence =
    score === null
      ? 0
      : clamp(
          Math.abs(
            score,
          ) *
            0.65 +
          (
            confirmations /
            Math.max(
              1,
              components.length,
            )
          ) *
            35,
          0,
          100,
        );

  if (
    level2Available
  ) {
    confidence *=
      0.70 +
      dataQuality *
        0.30;
  }

  confidence =
    clamp(
      confidence,
      0,
      100,
    );

  const probabilities =
    calculateProbabilities(
      score ?? 0,
    );

  /* ENTRY / RISK */

  let entryLow:
    number | null =
      null;

  let entryHigh:
    number | null =
      null;

  let stopLoss:
    number | null =
      null;

  let tp1:
    number | null =
      null;

  let tp2:
    number | null =
      null;

  let tp3:
    number | null =
      null;

  let invalidation:
    number | null =
      null;

  if (
    atr !== null &&
    signal !== 'WAIT'
  ) {
    const entryZone =
      atr *
      0.2;

    entryLow =
      currentPrice -
      entryZone;

    entryHigh =
      currentPrice +
      entryZone;

    if (
      signal === 'LONG'
    ) {
      stopLoss =
        currentPrice -
        atr *
          1.35;

      tp1 =
        currentPrice +
        atr;

      tp2 =
        currentPrice +
        atr *
          1.8;

      tp3 =
        currentPrice +
        atr *
          2.6;

      invalidation =
        support !== null
          ? Math.min(
              support,
              stopLoss,
            )
          : stopLoss;
    } else {
      stopLoss =
        currentPrice +
        atr *
          1.35;

      tp1 =
        currentPrice -
        atr;

      tp2 =
        currentPrice -
        atr *
          1.8;

      tp3 =
        currentPrice -
        atr *
          2.6;

      invalidation =
        resistance !==
        null
          ? Math.max(
              resistance,
              stopLoss,
            )
          : stopLoss;
    }
  }

  return {
    trend,

    momentum,

    volumeDelta,

    structure,

    orderFlow,

    liquidity,

    candleScore,

    score,

    bull:
      probabilities.bull,

    neutral:
      probabilities.neutral,

    bear:
      probabilities.bear,

    signal,

    confidence,

    confirmations,

    availableWeight,

    regime,

    ema9,

    ema21,

    ema50,

    ema100,

    rsi,

    macd:
      macd.macd,

    macdSignal:
      macd.signal,

    macdHistogram:
      macd.histogram,

    atr,

    avgVolume:
      avgVolume ||
      null,

    currentVolume:
      currentVolume ||
      null,

    support,

    resistance,

    entryLow,

    entryHigh,

    stopLoss,

    tp1,

    tp2,

    tp3,

    invalidation,

    sweep,

    obi:
      safeNumber(
        orderBookMetrics?.obi,
      ),

    bidVolume:
      safeNumber(
        orderBookMetrics?.bidVolume,
      ),

    askVolume:
      safeNumber(
        orderBookMetrics?.askVolume,
      ),

    bidWallPrice:
      safeNumber(
        orderBookMetrics?.bidWallPrice,
      ),

    askWallPrice:
      safeNumber(
        orderBookMetrics?.askWallPrice,
      ),

    spread:
      safeNumber(
        orderBookMetrics?.spread,
      ),

    microPrice:
      safeNumber(
        orderBookMetrics?.microPrice,
      ),

    spoofRisk:
      safeNumber(
        orderBookMetrics?.spoofRisk,
      ),

    level2Available,

    heatmapScore:
      heatmapAnalysis.score,

    heatmapSnapshots:
      heatmapAnalysis.snapshots,

    heatmapBidPressure:
      heatmapAnalysis.bidPressure,

    heatmapAskPressure:
      heatmapAnalysis.askPressure,

    heatmapBidApproach:
      heatmapAnalysis.bidApproach,

    heatmapAskApproach:
      heatmapAnalysis.askApproach,

    heatmapBidGrowth:
      heatmapAnalysis.bidGrowth,

    heatmapAskGrowth:
      heatmapAnalysis.askGrowth,

    heatmapBidRemoval:
      heatmapAnalysis.bidRemoval,

    heatmapAskRemoval:
      heatmapAnalysis.askRemoval,

    heatmapBidPersistence:
      heatmapAnalysis.bidPersistence,

    heatmapAskPersistence:
      heatmapAnalysis.askPersistence,

    heatmapBidAbsorption:
      heatmapAnalysis.bidAbsorption,

    heatmapAskAbsorption:
      heatmapAnalysis.askAbsorption,

    dataQuality,
  };
}

/* =========================================================
   LIVE HEATMAP VISUALIZATION
   ========================================================= */

function buildHeatmap(
  bids:
    LexOrderBookLevel[],

  asks:
    LexOrderBookLevel[],
): HeatmapLevel[] {
  const valid = [
    ...bids.map(
      (level) => ({
        side:
          'bid' as const,

        level,
      }),
    ),

    ...asks.map(
      (level) => ({
        side:
          'ask' as const,

        level,
      }),
    ),
  ].filter(
    ({ level }) =>
      Number.isFinite(
        level.price,
      ) &&
      Number.isFinite(
        level.size,
      ) &&
      level.price > 0 &&
      level.size > 0,
  );

  if (
    valid.length === 0
  ) {
    return [];
  }

  const maxSize =
    Math.max(
      0,
      ...valid.map(
        ({ level }) =>
          level.size,
      ),
    );

  if (
    maxSize <= 0
  ) {
    return [];
  }

  const normalized =
    valid.map(
      ({
        side,
        level,
      }) => {
        const ageMs =
          Math.max(
            0,
            level.ageMs ??
              0,
          );

        const sizeStrength =
          clamp(
            Math.log1p(
              level.size,
            ) /
              Math.log1p(
                maxSize,
              ),
            0,
            1,
          );

        const ageStrength =
          clamp(
            ageMs /
              30_000,
            0,
            1,
          );

        const updateStrength =
          clamp(
            (
              level.updateCount ??
              0
            ) /
              10,
            0,
            1,
          );

        const persistence =
          ageStrength *
            0.6 +
          updateStrength *
            0.4;

        const largeBonus =
          level.isLarge
            ? 0.10
            : 0;

        const intensity =
          clamp(
            sizeStrength *
              (
                0.70 +
                persistence *
                  0.30
              ) +
              largeBonus,
            0,
            1,
          );

        return {
          side,

          price:
            level.price,

          size:
            level.size,

          intensity,

          ageMs,

          persistent:
            persistence >=
            0.45,

          large:
            Boolean(
              level.isLarge,
            ),
        };
      },
    );

  const bidsHeatmap =
    normalized
      .filter(
        (level) =>
          level.side ===
          'bid',
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.intensity -
          a.intensity,
      )
      .slice(0, 40);

  const asksHeatmap =
    normalized
      .filter(
        (level) =>
          level.side ===
          'ask',
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.intensity -
          a.intensity,
      )
      .slice(0, 40);

  return [
    ...bidsHeatmap,
    ...asksHeatmap,
  ];
}

/* =========================================================
   TIMEFRAME SELECTOR
   ========================================================= */

function TimeframeSelector({
  value,
  onChange,
}: {
  value:
    GateTimeframe;

  onChange?: (
    timeframe:
      GateTimeframe,
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
            key={
              item
            }
            type="button"
            className={`lex-timeframe-button${
              item === value
                ? ' active'
                : ''
            }`}
            aria-pressed={
              item === value
            }
            onClick={() => {
              if (
                item !== value
              ) {
                onChange?.(
                  item,
                );
              }
            }}
          >
            {item}
          </button>
        ),
      )}
    </div>
  );
}

/* =========================================================
   LAYER CONTROLS
   ========================================================= */

function LayerControls({
  layers,
  setLayers,
  onLive,
}: {
  layers:
    ChartLayers;

  setLayers:
    React.Dispatch<
      React.SetStateAction<ChartLayers>
    >;

  onLive:
    () => void;
}) {
  const toggle =
    (
      key:
        keyof ChartLayers,
    ) => {
      setLayers(
        (current) => ({
          ...current,

          [key]:
            !current[
              key
            ],
        }),
      );
    };

  return (
    <div className="lex-chart-layer-controls">
      <button
        type="button"
        className={
          layers.lex
            ? 'active'
            : ''
        }
        onClick={() =>
          toggle('lex')
        }
      >
        LEX
      </button>

      <button
        type="button"
        className={
          layers.heatmap
            ? 'active'
            : ''
        }
        onClick={() =>
          toggle(
            'heatmap',
          )
        }
      >
        HEATMAP
      </button>

      <button
        type="button"
        className={
          layers.ema
            ? 'active'
            : ''
        }
        onClick={() =>
          toggle('ema')
        }
      >
        EMA
      </button>

      <button
        type="button"
        className={
          layers.levels
            ? 'active'
            : ''
        }
        onClick={() =>
          toggle(
            'levels',
          )
        }
      >
        LEVELS
      </button>

      <button
        type="button"
        className="lex-chart-live-button"
        onClick={
          onLive
        }
      >
        <Crosshair
          size={13}
        />

        LIVE
      </button>
    </div>
  );
}

/* =========================================================
   HEATMAP OVERLAY
   ========================================================= */

function HeatmapOverlay({
  levels,
  chart,
  series,
}: {
  levels:
    HeatmapLevel[];

  chart:
    IChartApi | null;

  series:
    ISeriesApi<'Candlestick'> | null;
}) {
  const [
    revision,
    setRevision,
  ] =
    useState(0);

  const frameRef =
    useRef<number | null>(
      null,
    );

  useEffect(() => {
    if (
      !chart ||
      !series
    ) {
      return;
    }

    let disposed =
      false;

    let trackerFrame:
      number | null =
        null;

    let previousCoordinates =
      '';

    const refresh =
      () => {
        if (
          disposed ||
          frameRef.current !==
            null
        ) {
          return;
        }

        frameRef.current =
          window.requestAnimationFrame(
            () => {
              frameRef.current =
                null;

              if (
                !disposed
              ) {
                setRevision(
                  (value) =>
                    value +
                    1,
                );
              }
            },
          );
      };

    const trackCoordinates =
      () => {
        if (
          disposed
        ) {
          return;
        }

        const coordinateKey =
          levels
            .slice(0, 16)
            .map(
              (level) => {
                const coordinate =
                  series.priceToCoordinate(
                    level.price,
                  );

                if (
                  coordinate ===
                  null
                ) {
                  return 'x';
                }

                return String(
                  Math.round(
                    coordinate *
                      10,
                  ) /
                    10,
                );
              },
            )
            .join('|');

        if (
          coordinateKey !==
          previousCoordinates
        ) {
          previousCoordinates =
            coordinateKey;

          refresh();
        }

        trackerFrame =
          window.requestAnimationFrame(
            trackCoordinates,
          );
      };

    const timeScale =
      chart.timeScale();

    timeScale.subscribeVisibleLogicalRangeChange(
      refresh,
    );

    window.addEventListener(
      'resize',
      refresh,
    );

    trackerFrame =
      window.requestAnimationFrame(
        trackCoordinates,
      );

    return () => {
      disposed =
        true;

      timeScale.unsubscribeVisibleLogicalRangeChange(
        refresh,
      );

      window.removeEventListener(
        'resize',
        refresh,
      );

      if (
        trackerFrame !==
        null
      ) {
        window.cancelAnimationFrame(
          trackerFrame,
        );
      }

      if (
        frameRef.current !==
        null
      ) {
        window.cancelAnimationFrame(
          frameRef.current,
        );

        frameRef.current =
          null;
      }
    };
  }, [
    chart,
    levels,
    series,
  ]);

  void revision;

  if (
    !series ||
    levels.length === 0
  ) {
    return null;
  }

  return (
    <div
      className="lex-liquidity-heatmap-overlay"
      aria-hidden="true"
    >
      {levels.map(
        (
          level,
          index,
        ) => {
          const y =
            series.priceToCoordinate(
              level.price,
            );

          if (
            y === null
          ) {
            return null;
          }

          const opacity =
            clamp(
              0.10 +
                level.intensity *
                  0.52,
              0.10,
              0.62,
            );

          const width =
            clamp(
              25 +
                level.intensity *
                  75,
              25,
              100,
            );

          return (
            <div
              key={`${level.side}-${level.price}-${index}`}
              className={`lex-heatmap-level ${level.side}${
                level.large
                  ? ' wall'
                  : ''
              }${
                level.persistent
                  ? ' persistent'
                  : ''
              }`}
              style={{
                top:
                  `${y}px`,

                width:
                  `${width}%`,

                opacity,
              }}
            >
              <span>
                {formatPrice(
                  level.price,
                )}
              </span>

              {level.large && (
                <strong>
                  WALL
                </strong>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}

/* =========================================================
   REAL CHART AREA
   ========================================================= */

function RealChartArea({
  pair,
  baseAsset,
  quoteAsset,
  timeframe,
  candles,
  loading,
  error,
  metrics,
  heatmap,
  layers,
}: {
  pair: string;

  baseAsset: string;

  quoteAsset: string;

  timeframe:
    GateTimeframe;

  candles:
    GateCandle[];

  loading: boolean;

  error:
    string | null;

  metrics:
    LexMetrics;

  heatmap:
    HeatmapLevel[];

  layers:
    ChartLayers;
}) {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const chartRef =
    useRef<IChartApi | null>(
      null,
    );

  const candleSeriesRef =
    useRef<
      ISeriesApi<'Candlestick'> | null
    >(null);

  const volumeSeriesRef =
    useRef<
      ISeriesApi<'Histogram'> | null
    >(null);

  const ema9Ref =
    useRef<
      ISeriesApi<'Line'> | null
    >(null);

  const ema21Ref =
    useRef<
      ISeriesApi<'Line'> | null
    >(null);

  const ema50Ref =
    useRef<
      ISeriesApi<'Line'> | null
    >(null);

  const ema100Ref =
    useRef<
      ISeriesApi<'Line'> | null
    >(null);

  const previousKeyRef =
    useRef('');

  const [
    chartReady,
    setChartReady,
  ] =
    useState(false);

  useEffect(() => {
    const container =
      containerRef.current;

    if (!container) {
      return;
    }

    const chart =
      createChart(
        container,
        {
          width:
            container.clientWidth,

          height:
            Math.max(
              390,
              Math.min(
                680,
                window.innerHeight *
                  0.60,
              ),
            ),

          layout: {
            background: {
              type:
                ColorType.Solid,

              color:
                '#071017',
            },

            textColor:
              '#71838e',

            fontSize: 11,
          },

          grid: {
            vertLines: {
              color:
                'rgba(109,151,178,0.055)',
            },

            horzLines: {
              color:
                'rgba(109,151,178,0.055)',
            },
          },

          rightPriceScale: {
            borderColor:
              'rgba(109,151,178,0.16)',

            autoScale:
              true,

            scaleMargins: {
              top: 0.08,

              bottom: 0.22,
            },
          },

          timeScale: {
            borderColor:
              'rgba(109,151,178,0.16)',

            timeVisible:
              true,

            secondsVisible:
              false,

            rightOffset: 5,

            barSpacing: 8,

            minBarSpacing: 2,

            lockVisibleTimeRangeOnResize:
              true,

            shiftVisibleRangeOnNewBar:
              false,
          },

          handleScroll: {
            mouseWheel:
              true,

            pressedMouseMove:
              true,

            horzTouchDrag:
              true,

            vertTouchDrag:
              true,
          },

          handleScale: {
            axisPressedMouseMove:
              true,

            mouseWheel:
              true,

            pinch:
              true,
          },

          kineticScroll: {
            mouse:
              true,

            touch:
              true,
          },
        },
      );

    const candlesSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor:
            '#49d5a6',

          downColor:
            '#ef716c',

          borderUpColor:
            '#49d5a6',

          borderDownColor:
            '#ef716c',

          wickUpColor:
            '#49d5a6',

          wickDownColor:
            '#ef716c',

          priceLineVisible:
            true,

          lastValueVisible:
            true,
        },
      );

    const volume =
      chart.addSeries(
        HistogramSeries,
        {
          priceFormat: {
            type:
              'volume',
          },

          priceScaleId:
            '',
        },
      );

    volume
      .priceScale()
      .applyOptions({
        scaleMargins: {
          top: 0.82,

          bottom: 0,
        },
      });

    const ema9 =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 1,

          priceLineVisible:
            false,

          lastValueVisible:
            false,
        },
      );

    const ema21 =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 1,

          priceLineVisible:
            false,

          lastValueVisible:
            false,
        },
      );

    const ema50 =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 1,

          priceLineVisible:
            false,

          lastValueVisible:
            false,
        },
      );

    const ema100 =
      chart.addSeries(
        LineSeries,
        {
          lineWidth: 1,

          priceLineVisible:
            false,

          lastValueVisible:
            false,
        },
      );

    chartRef.current =
      chart;

    candleSeriesRef.current =
      candlesSeries;

    volumeSeriesRef.current =
      volume;

    ema9Ref.current =
      ema9;

    ema21Ref.current =
      ema21;

    ema50Ref.current =
      ema50;

    ema100Ref.current =
      ema100;

    setChartReady(true);

    const resize =
      () => {
        const current =
          containerRef.current;

        if (!current) {
          return;
        }

        chart.applyOptions({
          width:
            current.clientWidth,

          height:
            Math.max(
              390,
              Math.min(
                680,
                window.innerHeight *
                  0.60,
              ),
            ),
        });
      };

    const observer =
      new ResizeObserver(
        resize,
      );

    observer.observe(
      container,
    );

    window.addEventListener(
      'resize',
      resize,
    );

    document.addEventListener(
      'fullscreenchange',
      resize,
    );

    return () => {
      observer.disconnect();

      window.removeEventListener(
        'resize',
        resize,
      );

      document.removeEventListener(
        'fullscreenchange',
        resize,
      );

      setChartReady(false);

      chart.remove();

      chartRef.current =
        null;

      candleSeriesRef.current =
        null;

      volumeSeriesRef.current =
        null;

      ema9Ref.current =
        null;

      ema21Ref.current =
        null;

      ema50Ref.current =
        null;

      ema100Ref.current =
        null;
    };
  }, []);

  useEffect(() => {
    const handleLive =
      () => {
        chartRef.current
          ?.timeScale()
          .scrollToRealTime();
      };

    window.addEventListener(
      'lex-chart-live',
      handleLive,
    );

    return () => {
      window.removeEventListener(
        'lex-chart-live',
        handleLive,
      );
    };
  }, []);

  useEffect(() => {
    const candleMap =
      new Map<
        number,
        {
          time: Time;

          open: number;

          high: number;

          low: number;

          close: number;
        }
      >();

    const volumeMap =
      new Map<
        number,
        {
          time: Time;

          value: number;

          color: string;
        }
      >();

    for (
      const candle of candles
    ) {
      const time =
        timestampToChartTime(
          candle.timestamp,
        );

      const numericTime =
        Number(time);

      candleMap.set(
        numericTime,
        {
          time,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,
        },
      );

      volumeMap.set(
        numericTime,
        {
          time,

          value:
            candle.volume,

          color:
            candle.close >=
            candle.open
              ? 'rgba(73,213,166,0.30)'
              : 'rgba(239,113,108,0.30)',
        },
      );
    }

    const candleData =
      Array.from(
        candleMap.values(),
      ).sort(
        (
          a,
          b,
        ) =>
          Number(
            a.time,
          ) -
          Number(
            b.time,
          ),
      );

    const volumeData =
      Array.from(
        volumeMap.values(),
      ).sort(
        (
          a,
          b,
        ) =>
          Number(
            a.time,
          ) -
          Number(
            b.time,
          ),
      );

    candleSeriesRef.current?.setData(
      candleData,
    );

    volumeSeriesRef.current?.setData(
      volumeData,
    );

    const closes =
      candles.map(
        (candle) =>
          candle.close,
      );

    const buildEmaData =
      (
        period: number,
      ) => {
        const values =
          emaSeries(
            closes,
            period,
          );

        return candles.map(
          (
            candle,
            index,
          ) => ({
            time:
              timestampToChartTime(
                candle.timestamp,
              ),

            value:
              values[index],
          }),
        );
      };

    ema9Ref.current?.setData(
      layers.ema
        ? buildEmaData(9)
        : [],
    );

    ema21Ref.current?.setData(
      layers.ema
        ? buildEmaData(21)
        : [],
    );

    ema50Ref.current?.setData(
      layers.ema
        ? buildEmaData(50)
        : [],
    );

    ema100Ref.current?.setData(
      layers.ema
        ? buildEmaData(100)
        : [],
    );

    const key =
      `${pair}_${timeframe}`;

    /*
     * FIX:
     * switching XRP -> BTC etc. resets both
     * horizontal range and PRICE SCALE.
     */

    if (
      key !==
      previousKeyRef.current
    ) {
      previousKeyRef.current =
        key;

      requestAnimationFrame(
        () => {
          chartRef.current
            ?.timeScale()
            .fitContent();

          candleSeriesRef.current
            ?.priceScale()
            .applyOptions({
              autoScale:
                true,
            });
        },
      );
    }
  }, [
    candles,
    layers.ema,
    pair,
    timeframe,
  ]);

  useEffect(() => {
    const series =
      candleSeriesRef.current;

    if (!series) {
      return;
    }

    const priceLines:
      ReturnType<
        typeof series.createPriceLine
      >[] = [];

    const addLine =
      (
        price:
          number | null,

        title: string,
      ) => {
        if (
          price === null ||
          !Number.isFinite(
            price,
          )
        ) {
          return;
        }

        priceLines.push(
          series.createPriceLine({
            price,

            title,

            lineWidth: 1,

            axisLabelVisible:
              true,

            lineStyle: 2,
          }),
        );
      };

    if (
      layers.levels
    ) {
      addLine(
        metrics.support,
        'SUP',
      );

      addLine(
        metrics.resistance,
        'RES',
      );

      addLine(
        metrics.bidWallPrice,
        'BID WALL',
      );

      addLine(
        metrics.askWallPrice,
        'ASK WALL',
      );
    }

    if (
      layers.lex
    ) {
      addLine(
        metrics.entryLow,
        'ENTRY L',
      );

      addLine(
        metrics.entryHigh,
        'ENTRY H',
      );

      addLine(
        metrics.stopLoss,
        'SL',
      );

      addLine(
        metrics.tp1,
        'TP1',
      );

      addLine(
        metrics.tp2,
        'TP2',
      );

      addLine(
        metrics.tp3,
        'TP3',
      );

      addLine(
        metrics.invalidation,
        'INVALID',
      );
    }

    return () => {
      for (
        const line of priceLines
      ) {
        series.removePriceLine(
          line,
        );
      }
    };
  }, [
    layers.lex,
    layers.levels,
    metrics.askWallPrice,
    metrics.bidWallPrice,
    metrics.entryHigh,
    metrics.entryLow,
    metrics.invalidation,
    metrics.resistance,
    metrics.stopLoss,
    metrics.support,
    metrics.tp1,
    metrics.tp2,
    metrics.tp3,
  ]);

  return (
    <div className="lex-chart-stage lex-real-chart-stage">
      <div
        ref={
          containerRef
        }
        className="lex-real-chart"
      />

      {layers.heatmap &&
        chartReady && (
          <HeatmapOverlay
            levels={
              heatmap
            }
            chart={
              chartRef.current
            }
            series={
              candleSeriesRef.current
            }
          />
        )}

      <div className="lex-chart-live-overlay">
        <div>
          <CandlestickChart
            size={15}
          />

          <strong>
            {baseAsset}
            {' / '}
            {quoteAsset}
          </strong>

          <span>
            {timeframe}
          </span>
        </div>

        {error ? (
          <span className="lex-chart-data-state negative">
            DATA ERROR
          </span>
        ) : loading &&
          candles.length ===
            0 ? (
          <span className="lex-chart-data-state">
            LOADING
          </span>
        ) : (
          <span className="lex-chart-data-state live">
            {candles.length}{' '}
            REAL CANDLES
          </span>
        )}
      </div>

      {layers.lex && (
        <div
          className={`lex-chart-hud ${
            metrics.signal ===
            'LONG'
              ? 'positive'
              : metrics.signal ===
                  'SHORT'
                ? 'negative'
                : ''
          }`}
        >
          <span>
            LEX V2.4.2 FINAL
          </span>

          <strong>
            {metrics.signal}
          </strong>

          <small>
            SCORE{' '}
            {signed(
              metrics.score,
              1,
            )}

            {' • '}

            CONF{' '}

            {metrics.confidence.toFixed(
              0,
            )}
            %
          </small>
        </div>
      )}

      {error &&
        candles.length ===
          0 && (
          <div className="lex-chart-error">
            {error}
          </div>
        )}

      <button
        type="button"
        className="lex-chart-stage-live"
        onClick={() =>
          chartRef.current
            ?.timeScale()
            .scrollToRealTime()
        }
      >
        <Crosshair
          size={13}
        />

        LIVE
      </button>
    </div>
  );
}

/* =========================================================
   ENGINE CELL
   ========================================================= */

function EngineCell({
  label,
  value,
  max,
  unavailable = false,
}: {
  label: string;

  value:
    number | null;

  max: number;

  unavailable?: boolean;
}) {
  const direction =
    value !== null &&
    value > 0
      ? 'positive'
      : value !== null &&
          value < 0
        ? 'negative'
        : '';

  return (
    <div className="lex-engine-cell">
      <span>
        {label}
      </span>

      <strong
        className={
          direction
        }
      >
        {unavailable
          ? 'L2 —'
          : signed(
              value,
              1,
            )}
      </strong>

      <small>
        / {max}
      </small>
    </div>
  );
}

/* =========================================================
   ENGINE STRIP
   ========================================================= */

function LexEngineStrip({
  metrics,
}: {
  metrics:
    LexMetrics;
}) {
  const signalClass =
    metrics.signal ===
    'LONG'
      ? 'positive'
      : metrics.signal ===
          'SHORT'
        ? 'negative'
        : '';

  return (
    <section className="lex-engine-strip">
      <div className="lex-engine-heading">
        <div>
          <Activity
            size={15}
          />

          <span>
            LEX V2.4.2 FINAL
          </span>
        </div>

        <span
          className={`lex-engine-status ${signalClass}`}
        >
          {metrics.signal}
        </span>
      </div>

      <div className="lex-engine-summary">
        <div>
          <span>
            SCORE
          </span>

          <strong>
            {signed(
              metrics.score,
              1,
            )}
          </strong>
        </div>

        <div>
          <span>
            CONFIDENCE
          </span>

          <strong>
            {metrics.confidence.toFixed(
              0,
            )}
            %
          </strong>
        </div>

        <div>
          <span>
            DATA
          </span>

          <strong>
            {metrics.level2Available
              ? 'OHLCV + L2 + HM'
              : 'OHLCV'}
          </strong>
        </div>
      </div>

      <div className="lex-engine-grid">
        <EngineCell
          label="TREND"
          value={
            metrics.trend
          }
          max={25}
        />

        <EngineCell
          label="MOMENTUM"
          value={
            metrics.momentum
          }
          max={15}
        />

        <EngineCell
          label="VOLUME / DELTA"
          value={
            metrics.volumeDelta
          }
          max={15}
        />

        <EngineCell
          label="STRUCTURE"
          value={
            metrics.structure
          }
          max={15}
        />

        <EngineCell
          label="ORDER FLOW"
          value={
            metrics.orderFlow
          }
          max={20}
          unavailable={
            metrics.orderFlow ===
            null
          }
        />

        <EngineCell
          label="LIQUIDITY"
          value={
            metrics.liquidity
          }
          max={10}
          unavailable={
            metrics.liquidity ===
            null
          }
        />
      </div>
    </section>
  );
}

/* =========================================================
   FORECAST
   ========================================================= */

function ProbabilityPanel({
  metrics,
}: {
  metrics:
    LexMetrics;
}) {
  return (
    <section className="lex-chart-module">
      <div className="lex-module-header">
        <div>
          <Activity
            size={15}
          />

          <span>
            FORECAST
          </span>
        </div>

        <span className="lex-module-state">
          {metrics.level2Available
            ? 'OHLCV + LEVEL 2 + HEATMAP'
            : 'OHLCV ONLY'}
        </span>
      </div>

      <div className="lex-probability-grid">
        <div className="lex-probability-cell positive">
          <span>
            BULL
          </span>

          <strong>
            {metrics.bull.toFixed(
              1,
            )}
            %
          </strong>
        </div>

        <div className="lex-probability-cell">
          <span>
            NEUTRAL
          </span>

          <strong>
            {metrics.neutral.toFixed(
              1,
            )}
            %
          </strong>
        </div>

        <div className="lex-probability-cell negative">
          <span>
            BEAR
          </span>

          <strong>
            {metrics.bear.toFixed(
              1,
            )}
            %
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   MARKET INDICATORS
   ========================================================= */

function IndicatorPanel({
  metrics,
}: {
  metrics:
    LexMetrics;
}) {
  return (
    <section className="lex-chart-module">
      <div className="lex-module-header">
        <div>
          <BarChart3
            size={15}
          />

          <span>
            MARKET METRICS
          </span>
        </div>

        <span className="lex-module-state">
          REAL OHLCV
        </span>
      </div>

      <div className="lex-indicator-grid">
        <div>
          <span>
            EMA 9
          </span>

          <strong>
            {formatPrice(
              metrics.ema9,
            )}
          </strong>
        </div>

        <div>
          <span>
            EMA 21
          </span>

          <strong>
            {formatPrice(
              metrics.ema21,
            )}
          </strong>
        </div>

        <div>
          <span>
            EMA 50
          </span>

          <strong>
            {formatPrice(
              metrics.ema50,
            )}
          </strong>
        </div>

        <div>
          <span>
            EMA 100
          </span>

          <strong>
            {formatPrice(
              metrics.ema100,
            )}
          </strong>
        </div>

        <div>
          <span>
            RSI 14
          </span>

          <strong>
            {metrics.rsi ===
            null
              ? '—'
              : metrics.rsi.toFixed(
                  1,
                )}
          </strong>
        </div>

        <div>
          <span>
            MACD HIST
          </span>

          <strong>
            {signed(
              metrics.macdHistogram,
              6,
            )}
          </strong>
        </div>

        <div>
          <span>
            ATR 14
          </span>

          <strong>
            {formatPrice(
              metrics.atr,
            )}
          </strong>
        </div>

        <div>
          <span>
            VOLUME
          </span>

          <strong>
            {formatCompact(
              metrics.currentVolume,
            )}
          </strong>
        </div>

        <div>
          <span>
            SUPPORT
          </span>

          <strong>
            {formatPrice(
              metrics.support,
            )}
          </strong>
        </div>

        <div>
          <span>
            RESISTANCE
          </span>

          <strong>
            {formatPrice(
              metrics.resistance,
            )}
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   LEVEL-2 PANEL
   ========================================================= */

function LiquidityPanel({
  metrics,
}: {
  metrics:
    LexMetrics;
}) {
  return (
    <section className="lex-chart-module lex-heatmap-module">
      <div className="lex-module-header">
        <div>
          <Layers3
            size={15}
          />

          <span>
            ORDER BOOK / LIQUIDITY
          </span>
        </div>

        <span
          className={`lex-module-state ${
            metrics.level2Available
              ? 'positive'
              : ''
          }`}
        >
          {metrics.level2Available
            ? 'LEVEL 2 LIVE'
            : 'LEVEL 2 NOT CONNECTED'}
        </span>
      </div>

      <div className="lex-liquidity-summary">
        <div>
          <span>
            CANDLE SWEEP
          </span>

          <strong>
            {metrics.sweep}
          </strong>
        </div>

        <div>
          <span>
            OBI
          </span>

          <strong>
            {metrics.obi ===
            null
              ? '—'
              : `${signed(
                  metrics.obi *
                    100,
                  1,
                )}%`}
          </strong>
        </div>

        <div>
          <span>
            ORDER FLOW
          </span>

          <strong>
            {signed(
              metrics.orderFlow,
              1,
            )}
          </strong>
        </div>

        <div>
          <span>
            LIQUIDITY
          </span>

          <strong>
            {signed(
              metrics.liquidity,
              1,
            )}
          </strong>
        </div>

        <div>
          <span>
            BID VOLUME
          </span>

          <strong>
            {formatCompact(
              metrics.bidVolume,
            )}
          </strong>
        </div>

        <div>
          <span>
            ASK VOLUME
          </span>

          <strong>
            {formatCompact(
              metrics.askVolume,
            )}
          </strong>
        </div>

        <div>
          <span>
            BID WALL
          </span>

          <strong className="positive">
            {formatPrice(
              metrics.bidWallPrice,
            )}
          </strong>
        </div>

        <div>
          <span>
            ASK WALL
          </span>

          <strong className="negative">
            {formatPrice(
              metrics.askWallPrice,
            )}
          </strong>
        </div>

        <div>
          <span>
            MICRO PRICE
          </span>

          <strong>
            {formatPrice(
              metrics.microPrice,
            )}
          </strong>
        </div>

        <div>
          <span>
            SPREAD
          </span>

          <strong>
            {formatPrice(
              metrics.spread,
            )}
          </strong>
        </div>

        <div>
          <span>
            SPOOF RISK
          </span>

          <strong>
            {metrics.spoofRisk ===
            null
              ? '—'
              : `${clamp(
                  metrics.spoofRisk *
                    100,
                  0,
                  100,
                ).toFixed(
                  0,
                )}%`}
          </strong>
        </div>

        <div>
          <span>
            REGIME
          </span>

          <strong>
            {metrics.regime}
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   HISTORICAL HEATMAP PANEL
   ========================================================= */

function HeatmapAnalysisPanel({
  metrics,
}: {
  metrics:
    LexMetrics;
}) {
  const score =
    metrics.heatmapScore;

  const state =
    score === null
      ? 'NO HISTORY'
      : score >= 0.15
        ? 'BULL PRESSURE'
        : score <= -0.15
          ? 'BEAR PRESSURE'
          : 'BALANCED';

  const scoreClass =
    score !== null &&
    score > 0
      ? 'positive'
      : score !== null &&
          score < 0
        ? 'negative'
        : '';

  return (
    <section className="lex-chart-module lex-heatmap-analysis">
      <div className="lex-module-header">
        <div>
          <Layers3
            size={15}
          />

          <span>
            LIQUIDITY HEATMAP ANALYZER
          </span>
        </div>

        <span
          className={`lex-module-state ${scoreClass}`}
        >
          {state}
        </span>
      </div>

      <div className="lex-indicator-grid">
        <div>
          <span>
            HEATMAP SCORE
          </span>

          <strong
            className={
              scoreClass
            }
          >
            {score === null
              ? '—'
              : `${signed(
                  score *
                    100,
                  1,
                )}%`}
          </strong>
        </div>

        <div>
          <span>
            HISTORY
          </span>

          <strong>
            {metrics.heatmapSnapshots}
          </strong>
        </div>

        <div>
          <span>
            DATA QUALITY
          </span>

          <strong>
            {(
              metrics.dataQuality *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            BID PRESSURE
          </span>

          <strong className="positive">
            {(
              metrics.heatmapBidPressure *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK PRESSURE
          </span>

          <strong className="negative">
            {(
              metrics.heatmapAskPressure *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            BID APPROACH
          </span>

          <strong>
            {signed(
              metrics.heatmapBidApproach *
                100,
              1,
            )}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK APPROACH
          </span>

          <strong>
            {signed(
              metrics.heatmapAskApproach *
                100,
              1,
            )}
            %
          </strong>
        </div>

        <div>
          <span>
            BID GROWTH
          </span>

          <strong>
            {signed(
              metrics.heatmapBidGrowth *
                100,
              1,
            )}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK GROWTH
          </span>

          <strong>
            {signed(
              metrics.heatmapAskGrowth *
                100,
              1,
            )}
            %
          </strong>
        </div>

        <div>
          <span>
            BID REMOVAL
          </span>

          <strong className="negative">
            {(
              metrics.heatmapBidRemoval *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK REMOVAL
          </span>

          <strong className="positive">
            {(
              metrics.heatmapAskRemoval *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            BID PERSISTENCE
          </span>

          <strong>
            {(
              metrics.heatmapBidPersistence *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK PERSISTENCE
          </span>

          <strong>
            {(
              metrics.heatmapAskPersistence *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            BID ABSORPTION
          </span>

          <strong className="positive">
            {(
              metrics.heatmapBidAbsorption *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>

        <div>
          <span>
            ASK ABSORPTION
          </span>

          <strong className="negative">
            {(
              metrics.heatmapAskAbsorption *
              100
            ).toFixed(0)}
            %
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   TRADE PLAN
   ========================================================= */

function TradePlan({
  metrics,
  quoteAsset,
}: {
  metrics:
    LexMetrics;

  quoteAsset:
    string;
}) {
  const active =
    metrics.signal !==
    'WAIT';

  return (
    <section className="lex-chart-module lex-trade-plan">
      <div className="lex-module-header">
        <div>
          {metrics.signal ===
          'SHORT' ? (
            <TrendingDown
              size={15}
            />
          ) : (
            <TrendingUp
              size={15}
            />
          )}

          <span>
            ENTRY / RISK
          </span>
        </div>

        <span
          className={`lex-module-state ${
            metrics.signal ===
            'LONG'
              ? 'positive'
              : metrics.signal ===
                  'SHORT'
                ? 'negative'
                : ''
          }`}
        >
          {metrics.signal}
        </span>
      </div>

      <div className="lex-trade-grid">
        <div>
          <span>
            ENTRY ZONE
          </span>

          <strong>
            {active
              ? `${formatPrice(
                  metrics.entryLow,
                )} – ${formatPrice(
                  metrics.entryHigh,
                )}`
              : 'WAIT'}
          </strong>

          <small>
            {quoteAsset}
          </small>
        </div>

        <div>
          <span>
            STOP LOSS
          </span>

          <strong>
            {formatPrice(
              metrics.stopLoss,
            )}
          </strong>
        </div>

        <div>
          <span>
            TP1
          </span>

          <strong>
            {formatPrice(
              metrics.tp1,
            )}
          </strong>
        </div>

        <div>
          <span>
            TP2
          </span>

          <strong>
            {formatPrice(
              metrics.tp2,
            )}
          </strong>
        </div>

        <div>
          <span>
            TP3
          </span>

          <strong>
            {formatPrice(
              metrics.tp3,
            )}
          </strong>
        </div>

        <div>
          <span>
            INVALIDATION
          </span>

          <strong>
            {formatPrice(
              metrics.invalidation,
            )}
          </strong>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   MAIN
   LEX V2.4.2 FINAL
   ========================================================= */

export default function LexChart({
  baseAsset,

  quoteAsset,

  pair,

  lastPrice,

  priceChangePercent,

  candles,

  timeframe,

  onTimeframeChange,

  orderBookMetrics =
    null,

  orderBookBids = [],

  orderBookAsks = [],

  /*
   * FIX:
   * Accept historical heatmap directly.
   */

  orderBookHeatmap = [],

  candlesLoading =
    false,

  candlesError =
    null,
}: LexChartProps) {
  const screenRef =
    useRef<HTMLElement | null>(
      null,
    );

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

  const [
    layers,
    setLayers,
  ] =
    useState<ChartLayers>({
      lex: true,

      heatmap: true,

      ema: true,

      levels: true,
    });

  const validCandles =
    useMemo(
      () =>
        [...candles]
          .filter(
            (candle) =>
              Number.isFinite(
                candle.timestamp,
              ) &&
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
          )
          .sort(
            (
              a,
              b,
            ) =>
              a.timestamp -
              b.timestamp,
          ),
      [candles],
    );

  /*
   * FIX:
   * Historical heatmap is now part of engine calculation.
   */

  const metrics =
    useMemo(
      () =>
        calculateLexMetrics(
          validCandles,
          orderBookMetrics,
          orderBookHeatmap,
        ),
      [
        validCandles,
        orderBookMetrics,
        orderBookHeatmap,
      ],
    );

  const heatmap =
    useMemo(
      () =>
        buildHeatmap(
          orderBookBids,
          orderBookAsks,
        ),
      [
        orderBookAsks,
        orderBookBids,
      ],
    );

  const positive =
    priceChangePercent !==
      null &&
    priceChangePercent >=
      0;

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
          'lex-fullscreen-open',
        );

        return;
      }

      if (
        document.fullscreenElement
      ) {
        try {
          await document.exitFullscreen();
        } catch {
          // iPhone fallback
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
        // iPhone fallback
      }

      setPseudoFullscreen(
        true,
      );

      document.body.classList.add(
        'lex-fullscreen-open',
      );
    };

  useEffect(() => {
    return () => {
      document.body.classList.remove(
        'lex-fullscreen-open',
      );
    };
  }, []);

  const fullscreen =
    pseudoFullscreen ||
    nativeFullscreen;

  return (
    <section
      ref={
        screenRef
      }
      className={`lex-chart-screen${
        pseudoFullscreen
          ? ' lex-pseudo-fullscreen'
          : ''
      }`}
      aria-label="LEX V2.4.2 FINAL chart"
    >
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
              {formatPrice(
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
        </div>

        <button
          type="button"
          className="lex-chart-expand"
          aria-label={
            fullscreen
              ? 'Exit fullscreen'
              : 'Expand chart'
          }
          onClick={
            handleFullscreen
          }
        >
          {fullscreen ? (
            <Minimize2
              size={18}
            />
          ) : (
            <Maximize2
              size={18}
            />
          )}
        </button>
      </div>

      <TimeframeSelector
        value={
          timeframe
        }
        onChange={
          onTimeframeChange
        }
      />

      <LayerControls
        layers={
          layers
        }
        setLayers={
          setLayers
        }
        onLive={() => {
          window.dispatchEvent(
            new Event(
              'lex-chart-live',
            ),
          );
        }}
      />

      <RealChartArea
        pair={
          pair
        }
        baseAsset={
          baseAsset
        }
        quoteAsset={
          quoteAsset
        }
        timeframe={
          timeframe
        }
        candles={
          validCandles
        }
        loading={
          candlesLoading
        }
        error={
          candlesError
        }
        metrics={
          metrics
        }
        heatmap={
          heatmap
        }
        layers={
          layers
        }
      />

      <LexEngineStrip
        metrics={
          metrics
        }
      />

      <ProbabilityPanel
        metrics={
          metrics
        }
      />

      <IndicatorPanel
        metrics={
          metrics
        }
      />

      <LiquidityPanel
        metrics={
          metrics
        }
      />

      <HeatmapAnalysisPanel
        metrics={
          metrics
        }
      />

      <TradePlan
        metrics={
          metrics
        }
        quoteAsset={
          quoteAsset
        }
      />
    </section>
  );
}