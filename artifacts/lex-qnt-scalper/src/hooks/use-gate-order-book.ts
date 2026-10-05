import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  LexOrderBookLevel,
} from '@/components/LexOrderBook';

/* =========================================================
   LEX V2.4.2 FINAL
   GATE.IO LEVEL-2 ENGINE

   src/hooks/use-gate-order-book.ts

   FIXES
   - Stable WebSocket lifecycle
   - No reconnect loop caused by React state
   - lastUpdatedAtRef used internally
   - LIVE only after real Level-2 update
   - REST snapshot remains visible while WS connects
   - Controlled resync / reconnect
   - Sequence monitoring
   - Batched React publishing for iPhone
   ========================================================= */

/* =========================================================
   TYPES
   ========================================================= */

export type GateBookSide =
  | 'bid'
  | 'ask';

export type GateOrderBookLevel = {
  price: number;
  size: number;

  firstSeenAt: number;
  lastUpdatedAt: number;

  updateCount: number;
};

type RawLevel = {
  price: number;
  size: number;
};

type LevelDelta = {
  price: number;

  previousSize: number;
  nextSize: number;

  added: number;
  pulled: number;

  removed: boolean;
  created: boolean;
};

/* =========================================================
   MULTI DEPTH
   ========================================================= */

export type LexDepthMetric = {
  depthPercent: number;

  bidVolume: number;
  askVolume: number;

  obi: number;
};

/* =========================================================
   HEATMAP
   ========================================================= */

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

/* =========================================================
   EXTENDED METRICS
   ========================================================= */

export type LexLevel2Metrics = {
  obi: number;

  orderFlow: number;

  liquidityPressure: number;

  bidVolume: number;
  askVolume: number;

  bidWallPrice:
    number | null;

  askWallPrice:
    number | null;

  bidWallSize:
    number | null;

  askWallSize:
    number | null;

  spread:
    number | null;

  microPrice:
    number | null;

  absorption: number;

  replenishment: number;

  spoofRisk: number;

  updatedAt: number;

  /* MULTI DEPTH */

  multiDepth:
    LexDepthMetric[];

  obi01: number;
  obi025: number;
  obi05: number;
  obi1: number;
  obi2: number;

  /* ADD / PULL */

  bidAdd: number;
  askAdd: number;

  bidPull: number;
  askPull: number;

  bidAddNormalized: number;
  askAddNormalized: number;

  bidPullNormalized: number;
  askPullNormalized: number;

  /* PERSISTENCE */

  bidPersistence: number;
  askPersistence: number;

  bidWallAgeMs: number;
  askWallAgeMs: number;

  bidWallDistancePercent:
    number | null;

  askWallDistancePercent:
    number | null;

  /* MICROSTRUCTURE */

  microPriceBias: number;

  spreadPercent:
    number | null;

  /* HISTORY */

  heatmap:
    LexHeatmapSnapshot[];

  /* QUALITY */

  dataQuality: number;

  sequenceHealthy: boolean;

  resyncing: boolean;

  bookAgeMs: number;

  /* DEBUG */

  lastSequence:
    number | null;

  gapCount: number;
};

/* =========================================================
   OPTIONS
   ========================================================= */

export type UseGateOrderBookOptions = {
  enabled?: boolean;

  limit?: number;

  updateInterval?:
    | '100ms'
    | '1000ms';
};

/* =========================================================
   RESULT
   ========================================================= */

export type UseGateOrderBookResult = {
  bids:
    LexOrderBookLevel[];

  asks:
    LexOrderBookLevel[];

  lastPrice:
    number | null;

  metrics:
    LexLevel2Metrics | null;

  heatmap:
    LexHeatmapSnapshot[];

  connected: boolean;

  loading: boolean;

  error:
    string | null;

  lastUpdatedAt:
    number | null;

  reload:
    () => void;
};

/* =========================================================
   GATE.IO
   ========================================================= */

const GATE_REST_BASE =
  'https://api.gateio.ws/api/v4';

const GATE_WS_URL =
  'wss://api.gateio.ws/ws/v4/';

/* =========================================================
   CONFIG
   ========================================================= */

const DEFAULT_LIMIT = 200;

const MAX_BOOK_LEVELS = 200;

const STALE_AFTER_MS =
  15_000;

const RECONNECT_DELAY_MS =
  2_500;

const RESYNC_DELAY_MS =
  500;

const PUBLISH_INTERVAL_MS =
  100;

const LARGE_ORDER_MULTIPLIER =
  4;

const HISTORY_WINDOW_MS =
  60_000;

const MAX_HEATMAP_SNAPSHOTS =
  120;

const HEATMAP_LEVELS_PER_SIDE =
  50;

const SPOOF_SHORT_LIFE_MS =
  5_000;

const PERSISTENCE_FULL_MS =
  30_000;

const DEPTH_ZONES = [
  0.1,
  0.25,
  0.5,
  1,
  2,
] as const;

/* =========================================================
   INTERNAL TYPES
   ========================================================= */

type BookMap =
  Map<
    number,
    GateOrderBookLevel
  >;

type RawGateOrderBook = {
  id?: unknown;
  current?: unknown;
  update?: unknown;
  asks?: unknown;
  bids?: unknown;
};

type GateWsMessage = {
  time?: unknown;
  time_ms?: unknown;
  channel?: unknown;
  event?: unknown;
  result?: unknown;
  error?: unknown;
};

type GateWsBookResult = {
  t?: unknown;
  e?: unknown;
  E?: unknown;

  s?: unknown;

  U?: unknown;
  u?: unknown;

  b?: unknown;
  a?: unknown;

  bids?: unknown;
  asks?: unknown;
};

type SnapshotResult = {
  bids:
    RawLevel[];

  asks:
    RawLevel[];

  timestamp: number;

  sequence:
    number | null;
};

type BookHistoryPoint = {
  timestamp: number;

  midPrice:
    number | null;

  bidVolume: number;
  askVolume: number;

  bestBidSize: number;
  bestAskSize: number;

  bidWallPrice:
    number | null;

  askWallPrice:
    number | null;

  bidWallSize: number;
  askWallSize: number;

  bidWallAgeMs: number;
  askWallAgeMs: number;

  obi: number;

  bidAdd: number;
  askAdd: number;

  bidPull: number;
  askPull: number;
};

type DeltaAccumulator = {
  bidAdd: number;
  askAdd: number;

  bidPull: number;
  askPull: number;

  bidEvents:
    LevelDelta[];

  askEvents:
    LevelDelta[];
};

type RemovedLargeOrder = {
  side:
    GateBookSide;

  price: number;

  size: number;

  lifetimeMs: number;

  removedAt: number;
};

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

function normalizePair(
  pair: string,
): string {
  return pair
    .trim()
    .toUpperCase()
    .replace('/', '_')
    .replace('-', '_');
}

function toFiniteNumber(
  value: unknown,
): number | null {
  const numeric =
    typeof value ===
    'number'
      ? value
      : Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : null;
}

function normalizeTimestamp(
  value: unknown,
): number {
  const numeric =
    toFiniteNumber(
      value,
    );

  if (
    numeric === null
  ) {
    return Date.now();
  }

  if (
    numeric <
    10_000_000_000
  ) {
    return (
      numeric *
      1000
    );
  }

  return numeric;
}

/* =========================================================
   PARSING
   ========================================================= */

function parseLevel(
  raw: unknown,
): RawLevel | null {
  if (
    !Array.isArray(
      raw,
    ) ||
    raw.length < 2
  ) {
    return null;
  }

  const price =
    toFiniteNumber(
      raw[0],
    );

  const size =
    toFiniteNumber(
      raw[1],
    );

  if (
    price === null ||
    size === null ||
    price <= 0 ||
    size < 0
  ) {
    return null;
  }

  return {
    price,
    size,
  };
}

function parseLevels(
  raw: unknown,
): RawLevel[] {
  if (
    !Array.isArray(
      raw,
    )
  ) {
    return [];
  }

  const result:
    RawLevel[] = [];

  for (
    const item of raw
  ) {
    const parsed =
      parseLevel(
        item,
      );

    if (parsed) {
      result.push(
        parsed,
      );
    }
  }

  return result;
}

/* =========================================================
   SNAPSHOT
   ========================================================= */

function applySnapshot(
  target: BookMap,
  levels:
    RawLevel[],
  timestamp: number,
) {
  target.clear();

  for (
    const level of levels
  ) {
    if (
      level.size <= 0
    ) {
      continue;
    }

    target.set(
      level.price,
      {
        price:
          level.price,

        size:
          level.size,

        firstSeenAt:
          timestamp,

        lastUpdatedAt:
          timestamp,

        updateCount: 1,
      },
    );
  }
}

/* =========================================================
   DELTA
   ========================================================= */

function applyDelta(
  target: BookMap,
  levels:
    RawLevel[],
  timestamp: number,
): LevelDelta[] {
  const changes:
    LevelDelta[] = [];

  for (
    const level of levels
  ) {
    const existing =
      target.get(
        level.price,
      );

    const previousSize =
      existing?.size ??
      0;

    const nextSize =
      level.size;

    const added =
      Math.max(
        0,
        nextSize -
          previousSize,
      );

    const pulled =
      Math.max(
        0,
        previousSize -
          nextSize,
      );

    changes.push({
      price:
        level.price,

      previousSize,
      nextSize,

      added,
      pulled,

      removed:
        nextSize === 0 &&
        previousSize > 0,

      created:
        previousSize === 0 &&
        nextSize > 0,
    });

    if (
      nextSize === 0
    ) {
      target.delete(
        level.price,
      );

      continue;
    }

    if (existing) {
      const changed =
        existing.size !==
        nextSize;

      target.set(
        level.price,
        {
          price:
            level.price,

          size:
            nextSize,

          firstSeenAt:
            existing.firstSeenAt,

          lastUpdatedAt:
            changed
              ? timestamp
              : existing.lastUpdatedAt,

          updateCount:
            changed
              ? existing.updateCount +
                1
              : existing.updateCount,
        },
      );

      continue;
    }

    target.set(
      level.price,
      {
        price:
          level.price,

        size:
          nextSize,

        firstSeenAt:
          timestamp,

        lastUpdatedAt:
          timestamp,

        updateCount: 1,
      },
    );
  }

  return changes;
}

/* =========================================================
   SORT
   ========================================================= */

function sortedBook(
  map: BookMap,
  side:
    GateBookSide,
  limit: number,
): GateOrderBookLevel[] {
  const levels =
    Array.from(
      map.values(),
    );

  levels.sort(
    side === 'bid'
      ? (
          a,
          b,
        ) =>
          b.price -
          a.price
      : (
          a,
          b,
        ) =>
          a.price -
          b.price,
  );

  return levels.slice(
    0,
    limit,
  );
}

/* =========================================================
   STATISTICS
   ========================================================= */

function median(
  values: number[],
): number {
  if (
    values.length === 0
  ) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (
        a,
        b,
      ) =>
        a - b,
    );

  const middle =
    Math.floor(
      sorted.length /
        2,
    );

  if (
    sorted.length %
      2 ===
    0
  ) {
    return (
      (
        sorted[
          middle - 1
        ] ?? 0
      ) +
      (
        sorted[
          middle
        ] ?? 0
      )
    ) / 2;
  }

  return (
    sorted[
      middle
    ] ?? 0
  );
}

function totalVolume(
  levels:
    GateOrderBookLevel[],
): number {
  return levels.reduce(
    (
      total,
      level,
    ) =>
      total +
      level.size,
    0,
  );
}

/* =========================================================
   OBI
   ========================================================= */

function calculateObi(
  bidVolume: number,
  askVolume: number,
): number {
  const total =
    bidVolume +
    askVolume;

  if (
    total <= 0
  ) {
    return 0;
  }

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

/* =========================================================
   MID PRICE
   ========================================================= */

function calculateMidPrice(
  bestBid:
    GateOrderBookLevel | undefined,
  bestAsk:
    GateOrderBookLevel | undefined,
): number | null {
  if (
    !bestBid ||
    !bestAsk
  ) {
    return null;
  }

  return (
    bestBid.price +
    bestAsk.price
  ) / 2;
}

/* =========================================================
   MICRO PRICE
   ========================================================= */

function calculateMicroPrice(
  bestBid:
    GateOrderBookLevel | undefined,
  bestAsk:
    GateOrderBookLevel | undefined,
): number | null {
  if (
    !bestBid ||
    !bestAsk
  ) {
    return null;
  }

  const total =
    bestBid.size +
    bestAsk.size;

  if (
    total <= 0
  ) {
    return (
      bestBid.price +
      bestAsk.price
    ) / 2;
  }

  return (
    bestAsk.price *
      bestBid.size +
    bestBid.price *
      bestAsk.size
  ) / total;
}

/* =========================================================
   WALL
   ========================================================= */

function findWall(
  levels:
    GateOrderBookLevel[],
): GateOrderBookLevel | null {
  if (
    levels.length === 0
  ) {
    return null;
  }

  return levels.reduce(
    (
      largest,
      current,
    ) =>
      current.size >
      largest.size
        ? current
        : largest,
  );
}

/* =========================================================
   LARGE ORDER THRESHOLD
   ========================================================= */

function calculateLargeThreshold(
  bids:
    GateOrderBookLevel[],
  asks:
    GateOrderBookLevel[],
): number {
  const sizes = [
    ...bids.map(
      (level) =>
        level.size,
    ),

    ...asks.map(
      (level) =>
        level.size,
    ),
  ].filter(
    (value) =>
      value > 0 &&
      Number.isFinite(
        value,
      ),
  );

  const base =
    median(
      sizes,
    );

  if (
    base <= 0
  ) {
    return Infinity;
  }

  return (
    base *
    LARGE_ORDER_MULTIPLIER
  );
}

/* =========================================================
   PUBLIC LEVEL
   ========================================================= */

function toPublicLevel(
  level:
    GateOrderBookLevel,
  now: number,
  largeThreshold: number,
): LexOrderBookLevel {
  return {
    price:
      level.price,

    size:
      level.size,

    total:
      level.price *
      level.size,

    ageMs:
      Math.max(
        0,
        now -
          level.firstSeenAt,
      ),

    firstSeenAt:
      level.firstSeenAt,

    lastUpdatedAt:
      level.lastUpdatedAt,

    updateCount:
      level.updateCount,

    isLarge:
      level.size >=
      largeThreshold,
  };
}

/* =========================================================
   MULTI DEPTH
   ========================================================= */

function calculateMultiDepth(
  bids:
    GateOrderBookLevel[],
  asks:
    GateOrderBookLevel[],
  midPrice:
    number | null,
): LexDepthMetric[] {
  if (
    midPrice === null ||
    midPrice <= 0
  ) {
    return DEPTH_ZONES.map(
      (
        depthPercent,
      ) => ({
        depthPercent,

        bidVolume: 0,
        askVolume: 0,

        obi: 0,
      }),
    );
  }

  return DEPTH_ZONES.map(
    (
      depthPercent,
    ) => {
      const ratio =
        depthPercent /
        100;

      const bidFloor =
        midPrice *
        (
          1 -
          ratio
        );

      const askCeiling =
        midPrice *
        (
          1 +
          ratio
        );

      const bidVolume =
        totalVolume(
          bids.filter(
            (
              level,
            ) =>
              level.price >=
              bidFloor,
          ),
        );

      const askVolume =
        totalVolume(
          asks.filter(
            (
              level,
            ) =>
              level.price <=
              askCeiling,
          ),
        );

      return {
        depthPercent,

        bidVolume,

        askVolume,

        obi:
          calculateObi(
            bidVolume,
            askVolume,
          ),
      };
    },
  );
}

function getDepthObi(
  metrics:
    LexDepthMetric[],
  depth: number,
): number {
  return (
    metrics.find(
      (
        item,
      ) =>
        item.depthPercent ===
        depth,
    )?.obi ??
    0
  );
}

/* =========================================================
   PERSISTENCE
   ========================================================= */

function calculatePersistence(
  ageMs: number,
  updateCount: number,
): number {
  const ageScore =
    clamp(
      ageMs /
        PERSISTENCE_FULL_MS,
      0,
      1,
    );

  const instability =
    clamp(
      Math.max(
        0,
        updateCount -
          10,
      ) /
        100,
      0,
      0.2,
    );

  return clamp(
    ageScore *
      (
        1 -
        instability
      ),
    0,
    1,
  );
}

/* =========================================================
   DELTA ACCUMULATOR
   ========================================================= */

function emptyDeltaAccumulator():
  DeltaAccumulator {
  return {
    bidAdd: 0,
    askAdd: 0,

    bidPull: 0,
    askPull: 0,

    bidEvents: [],
    askEvents: [],
  };
}

function accumulateDelta(
  accumulator:
    DeltaAccumulator,
  side:
    GateBookSide,
  changes:
    LevelDelta[],
) {
  for (
    const change of
      changes
  ) {
    if (
      side === 'bid'
    ) {
      accumulator.bidAdd +=
        change.added;

      accumulator.bidPull +=
        change.pulled;

      accumulator.bidEvents.push(
        change,
      );
    } else {
      accumulator.askAdd +=
        change.added;

      accumulator.askPull +=
        change.pulled;

      accumulator.askEvents.push(
        change,
      );
    }
  }
}

/* =========================================================
   NORMALIZED FLOW
   ========================================================= */

function normalizeFlowAmount(
  amount: number,
  referenceVolume: number,
): number {
  if (
    referenceVolume <= 0
  ) {
    return 0;
  }

  return clamp(
    amount /
      referenceVolume,
    0,
    1,
  );
}

/* =========================================================
   ORDER FLOW
   ========================================================= */

function calculateOrderFlow(
  multiDepth:
    LexDepthMetric[],
  bidAddNormalized: number,
  askAddNormalized: number,
  bidPullNormalized: number,
  askPullNormalized: number,
): number {
  const depthBias =
    getDepthObi(
      multiDepth,
      0.1,
    ) *
      0.35 +
    getDepthObi(
      multiDepth,
      0.25,
    ) *
      0.25 +
    getDepthObi(
      multiDepth,
      0.5,
    ) *
      0.20 +
    getDepthObi(
      multiDepth,
      1,
    ) *
      0.12 +
    getDepthObi(
      multiDepth,
      2,
    ) *
      0.08;

  const addPullBias =
    clamp(
      (
        bidAddNormalized +
        askPullNormalized
      ) -
        (
          askAddNormalized +
          bidPullNormalized
        ),
      -1,
      1,
    );

  return clamp(
    depthBias *
      0.55 +
    addPullBias *
      0.45,
    -1,
    1,
  );
}

/* =========================================================
   ABSORPTION
   ========================================================= */

function calculateAbsorption(
  history:
    BookHistoryPoint[],
): number {
  if (
    history.length <
    2
  ) {
    return 0;
  }

  const recent =
    history.slice(
      -8,
    );

  let bidScore =
    0;

  let askScore =
    0;

  for (
    let index = 1;
    index <
    recent.length;
    index += 1
  ) {
    const previous =
      recent[
        index - 1
      ];

    const current =
      recent[index];

    if (
      !previous ||
      !current
    ) {
      continue;
    }

    if (
      previous.bestBidSize >
        current.bestBidSize &&
      current.bidAdd >
        0
    ) {
      bidScore +=
        Math.min(
          previous.bestBidSize -
            current.bestBidSize,
          current.bidAdd,
        );
    }

    if (
      previous.bestAskSize >
        current.bestAskSize &&
      current.askAdd >
        0
    ) {
      askScore +=
        Math.min(
          previous.bestAskSize -
            current.bestAskSize,
          current.askAdd,
        );
    }
  }

  const total =
    bidScore +
    askScore;

  if (
    total <= 0
  ) {
    return 0;
  }

  return clamp(
    (
      bidScore -
      askScore
    ) /
      total,
    -1,
    1,
  );
}

/* =========================================================
   REPLENISHMENT
   ========================================================= */

function calculateReplenishment(
  history:
    BookHistoryPoint[],
): number {
  if (
    history.length <
    3
  ) {
    return 0;
  }

  const recent =
    history.slice(
      -10,
    );

  let bid =
    0;

  let ask =
    0;

  for (
    const point of
      recent
  ) {
    bid +=
      point.bidAdd;

    ask +=
      point.askAdd;
  }

  const total =
    bid +
    ask;

  if (
    total <= 0
  ) {
    return 0;
  }

  return clamp(
    (
      bid -
      ask
    ) /
      total,
    -1,
    1,
  );
}

/* =========================================================
   HEATMAP
   ========================================================= */

function buildHeatmapSnapshot(
  bids:
    GateOrderBookLevel[],
  asks:
    GateOrderBookLevel[],
  now: number,
  midPrice:
    number | null,
  largeThreshold: number,
): LexHeatmapSnapshot {
  const source = [
    ...bids
      .slice(
        0,
        HEATMAP_LEVELS_PER_SIDE,
      )
      .map(
        (
          level,
        ) => ({
          ...level,

          side:
            'bid' as const,
        }),
      ),

    ...asks
      .slice(
        0,
        HEATMAP_LEVELS_PER_SIDE,
      )
      .map(
        (
          level,
        ) => ({
          ...level,

          side:
            'ask' as const,
        }),
      ),
  ];

  const maximumSize =
    Math.max(
      0,
      ...source.map(
        (
          level,
        ) =>
          level.size,
      ),
    );

  const levels:
    LexHeatmapLevel[] =
    source.map(
      (
        level,
      ) => {
        const ageMs =
          Math.max(
            0,
            now -
              level.firstSeenAt,
          );

        const sizeIntensity =
          maximumSize >
          0
            ? clamp(
                level.size /
                  maximumSize,
                0,
                1,
              )
            : 0;

        const persistence =
          calculatePersistence(
            ageMs,
            level.updateCount,
          );

        const intensity =
          clamp(
            sizeIntensity *
              (
                0.75 +
                persistence *
                  0.25
              ),
            0,
            1,
          );

        return {
          price:
            level.price,

          size:
            level.size,

          side:
            level.side,

          intensity,

          ageMs,

          persistence,

          isWall:
            level.size >=
            largeThreshold,
        };
      },
    );

  return {
    timestamp:
      now,

    midPrice,

    levels,
  };
}

/* =========================================================
   SPOOF RISK
   ========================================================= */

function calculateSpoofRisk(
  removedOrders:
    RemovedLargeOrder[],
  now: number,
): number {
  const recent =
    removedOrders.filter(
      (
        order,
      ) =>
        now -
          order.removedAt <=
        30_000,
    );

  if (
    recent.length ===
    0
  ) {
    return 0;
  }

  let suspicious =
    0;

  for (
    const order of
      recent
  ) {
    if (
      order.lifetimeMs <=
      SPOOF_SHORT_LIFE_MS
    ) {
      suspicious +=
        1;
    }
  }

  return clamp(
    suspicious /
      Math.max(
        3,
        recent.length,
      ),
    0,
    1,
  );
}

/* =========================================================
   LIQUIDITY PRESSURE
   ========================================================= */

function calculateLiquidityPressure(
  multiDepth:
    LexDepthMetric[],
  microPrice:
    number | null,
  midPrice:
    number | null,
  spread:
    number | null,
  bidPersistence: number,
  askPersistence: number,
  spoofRisk: number,
): number {
  const depthPressure =
    getDepthObi(
      multiDepth,
      0.1,
    ) *
      0.35 +
    getDepthObi(
      multiDepth,
      0.25,
    ) *
      0.25 +
    getDepthObi(
      multiDepth,
      0.5,
    ) *
      0.20 +
    getDepthObi(
      multiDepth,
      1,
    ) *
      0.12 +
    getDepthObi(
      multiDepth,
      2,
    ) *
      0.08;

  let microBias =
    0;

  if (
    microPrice !==
      null &&
    midPrice !==
      null &&
    spread !==
      null &&
    spread >
      0
  ) {
    microBias =
      clamp(
        (
          microPrice -
          midPrice
        ) /
          (
            spread /
            2
          ),
        -1,
        1,
      );
  }

  const persistenceBias =
    clamp(
      bidPersistence -
        askPersistence,
      -1,
      1,
    );

  const reliability =
    clamp(
      1 -
        spoofRisk *
          0.65,
      0.35,
      1,
    );

  return clamp(
    (
      depthPressure *
        0.55 +
      microBias *
        0.25 +
      persistenceBias *
        0.20
    ) *
      reliability,
    -1,
    1,
  );
}

/* =========================================================
   REST SNAPSHOT
   ========================================================= */

async function fetchOrderBookSnapshot({
  pair,
  limit,
  signal,
}: {
  pair: string;

  limit: number;

  signal:
    AbortSignal;
}): Promise<SnapshotResult> {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        MAX_BOOK_LEVELS,
        Math.floor(
          limit,
        ),
      ),
    );

  const params =
    new URLSearchParams({
      currency_pair:
        pair,

      limit:
        String(
          safeLimit,
        ),

      with_id:
        'true',
    });

  const response =
    await fetch(
      `${GATE_REST_BASE}/spot/order_book?${params.toString()}`,
      {
        signal,

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
      `Gate.io order-book request failed (${response.status})`,
    );
  }

  const payload:
    unknown =
    await response.json();

  if (
    !payload ||
    typeof payload !==
      'object'
  ) {
    throw new Error(
      'Gate.io returned an invalid order-book snapshot.',
    );
  }

  const object =
    payload as RawGateOrderBook;

  const bids =
    parseLevels(
      object.bids,
    );

  const asks =
    parseLevels(
      object.asks,
    );

  if (
    bids.length ===
      0 &&
    asks.length ===
      0
  ) {
    throw new Error(
      'Gate.io returned an empty order book.',
    );
  }

  const sequence =
    toFiniteNumber(
      object.id,
    );

  const timestamp =
    normalizeTimestamp(
      object.current ??
        object.update,
    );

  return {
    bids,
    asks,

    timestamp,

    sequence:
      sequence ===
      null
        ? null
        : Math.floor(
            sequence,
          ),
  };
}

/* =========================================================
   HOOK
   ========================================================= */

export function useGateOrderBook(
  pair: string,
  options:
    UseGateOrderBookOptions = {},
): UseGateOrderBookResult {
  const {
    enabled = true,

    limit =
      DEFAULT_LIMIT,

    updateInterval =
      '100ms',
  } = options;

  /* =======================================================
     STATE
     ======================================================= */

  const [
    bids,
    setBids,
  ] =
    useState<
      LexOrderBookLevel[]
    >([]);

  const [
    asks,
    setAsks,
  ] =
    useState<
      LexOrderBookLevel[]
    >([]);

  const [
    metrics,
    setMetrics,
  ] =
    useState<
      LexLevel2Metrics | null
    >(null);

  const [
    heatmap,
    setHeatmap,
  ] =
    useState<
      LexHeatmapSnapshot[]
    >([]);

  const [
    connected,
    setConnected,
  ] =
    useState(
      false,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      false,
    );

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    lastUpdatedAt,
    setLastUpdatedAt,
  ] =
    useState<
      number | null
    >(null);

  const [
    reloadToken,
    setReloadToken,
  ] =
    useState(0);

  /* =======================================================
     REFS
     ======================================================= */

  const bidMapRef =
    useRef<BookMap>(
      new Map(),
    );

  const askMapRef =
    useRef<BookMap>(
      new Map(),
    );

  const historyRef =
    useRef<
      BookHistoryPoint[]
    >([]);

  const heatmapRef =
    useRef<
      LexHeatmapSnapshot[]
    >([]);

  const socketRef =
    useRef<
      WebSocket | null
    >(null);

  const reconnectTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const publishTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const resyncTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const mountedRef =
    useRef(
      true,
    );

  const generationRef =
    useRef(0);

  /*
   * FIX:
   * Internal engine freshness must not depend on React state.
   */

  const lastUpdatedAtRef =
    useRef<
      number | null
    >(null);

  /*
   * Has a real WS Level-2 update arrived?
   */

  const receivedLiveUpdateRef =
    useRef(
      false,
    );

  /*
   * Sequence state.
   */

  const lastSequenceRef =
    useRef<
      number | null
    >(null);

  const sequenceHealthyRef =
    useRef(
      true,
    );

  const resyncingRef =
    useRef(
      false,
    );

  const gapCountRef =
    useRef(0);

  const deltaAccumulatorRef =
    useRef<DeltaAccumulator>(
      emptyDeltaAccumulator(),
    );

  const removedLargeOrdersRef =
    useRef<
      RemovedLargeOrder[]
    >([]);

  const largeThresholdRef =
    useRef(
      Infinity,
    );

  /* =======================================================
     NORMALIZATION
     ======================================================= */

  const normalizedPair =
    useMemo(
      () =>
        normalizePair(
          pair,
        ),
      [pair],
    );

  const safeLimit =
    useMemo(
      () =>
        Math.max(
          1,
          Math.min(
            MAX_BOOK_LEVELS,
            Math.floor(
              limit,
            ),
          ),
        ),
      [limit],
    );

  /* =======================================================
     RELOAD
     ======================================================= */

  const reload =
    useCallback(
      () => {
        setReloadToken(
          (
            value,
          ) =>
            value +
            1,
        );
      },
      [],
    );

  /* =======================================================
     REGISTER REMOVED LARGE ORDERS
     ======================================================= */

  const registerRemovedOrders =
    useCallback(
      (
        side:
          GateBookSide,
        changes:
          LevelDelta[],
        mapBefore:
          Map<
            number,
            GateOrderBookLevel
          >,
        timestamp: number,
      ) => {
        const threshold =
          largeThresholdRef.current;

        if (
          !Number.isFinite(
            threshold,
          )
        ) {
          return;
        }

        for (
          const change of
            changes
        ) {
          if (
            !change.removed
          ) {
            continue;
          }

          const previous =
            mapBefore.get(
              change.price,
            );

          if (
            !previous ||
            previous.size <
              threshold
          ) {
            continue;
          }

          removedLargeOrdersRef.current.push({
            side,

            price:
              previous.price,

            size:
              previous.size,

            lifetimeMs:
              Math.max(
                0,
                timestamp -
                  previous.firstSeenAt,
              ),

            removedAt:
              timestamp,
          });
        }

        const cutoff =
          timestamp -
          30_000;

        removedLargeOrdersRef.current =
          removedLargeOrdersRef.current.filter(
            (
              order,
            ) =>
              order.removedAt >=
              cutoff,
          );
      },
      [],
    );

  /* =======================================================
     PUBLISH

     IMPORTANT:
     No dependency on lastUpdatedAt React state.
     ======================================================= */

  const publishBook =
    useCallback(
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const now =
          Date.now();

        const internalBids =
          sortedBook(
            bidMapRef.current,
            'bid',
            safeLimit,
          );

        const internalAsks =
          sortedBook(
            askMapRef.current,
            'ask',
            safeLimit,
          );

        const bestBid =
          internalBids[0];

        const bestAsk =
          internalAsks[0];

        const midPrice =
          calculateMidPrice(
            bestBid,
            bestAsk,
          );

        const spread =
          bestBid &&
          bestAsk
            ? Math.max(
                0,
                bestAsk.price -
                  bestBid.price,
              )
            : null;

        const spreadPercent =
          spread !==
            null &&
          midPrice !==
            null &&
          midPrice >
            0
            ? (
                spread /
                midPrice
              ) *
              100
            : null;

        const microPrice =
          calculateMicroPrice(
            bestBid,
            bestAsk,
          );

        let microPriceBias =
          0;

        if (
          microPrice !==
            null &&
          midPrice !==
            null &&
          spread !==
            null &&
          spread >
            0
        ) {
          microPriceBias =
            clamp(
              (
                microPrice -
                midPrice
              ) /
                (
                  spread /
                  2
                ),
              -1,
              1,
            );
        }

        /* MULTI DEPTH */

        const multiDepth =
          calculateMultiDepth(
            internalBids,
            internalAsks,
            midPrice,
          );

        const obi01 =
          getDepthObi(
            multiDepth,
            0.1,
          );

        const obi025 =
          getDepthObi(
            multiDepth,
            0.25,
          );

        const obi05 =
          getDepthObi(
            multiDepth,
            0.5,
          );

        const obi1 =
          getDepthObi(
            multiDepth,
            1,
          );

        const obi2 =
          getDepthObi(
            multiDepth,
            2,
          );

        const obi =
          clamp(
            obi01 *
              0.35 +
            obi025 *
              0.25 +
            obi05 *
              0.20 +
            obi1 *
              0.12 +
            obi2 *
              0.08,
            -1,
            1,
          );

        /* VOLUME */

        const bidVolume =
          totalVolume(
            internalBids,
          );

        const askVolume =
          totalVolume(
            internalAsks,
          );

        /* WALLS */

        const bidWall =
          findWall(
            internalBids,
          );

        const askWall =
          findWall(
            internalAsks,
          );

        const bidWallAgeMs =
          bidWall
            ? Math.max(
                0,
                now -
                  bidWall.firstSeenAt,
              )
            : 0;

        const askWallAgeMs =
          askWall
            ? Math.max(
                0,
                now -
                  askWall.firstSeenAt,
              )
            : 0;

        const bidPersistence =
          bidWall
            ? calculatePersistence(
                bidWallAgeMs,
                bidWall.updateCount,
              )
            : 0;

        const askPersistence =
          askWall
            ? calculatePersistence(
                askWallAgeMs,
                askWall.updateCount,
              )
            : 0;

        const bidWallDistancePercent =
          bidWall &&
          midPrice !==
            null &&
          midPrice >
            0
            ? (
                (
                  midPrice -
                  bidWall.price
                ) /
                midPrice
              ) *
              100
            : null;

        const askWallDistancePercent =
          askWall &&
          midPrice !==
            null &&
          midPrice >
            0
            ? (
                (
                  askWall.price -
                  midPrice
                ) /
                midPrice
              ) *
              100
            : null;

        /* ADD / PULL */

        const delta =
          deltaAccumulatorRef.current;

        const bidAdd =
          delta.bidAdd;

        const askAdd =
          delta.askAdd;

        const bidPull =
          delta.bidPull;

        const askPull =
          delta.askPull;

        deltaAccumulatorRef.current =
          emptyDeltaAccumulator();

        const bidAddNormalized =
          normalizeFlowAmount(
            bidAdd,
            bidVolume,
          );

        const askAddNormalized =
          normalizeFlowAmount(
            askAdd,
            askVolume,
          );

        const bidPullNormalized =
          normalizeFlowAmount(
            bidPull,
            bidVolume,
          );

        const askPullNormalized =
          normalizeFlowAmount(
            askPull,
            askVolume,
          );

        /* ORDER FLOW */

        const orderFlow =
          calculateOrderFlow(
            multiDepth,

            bidAddNormalized,
            askAddNormalized,

            bidPullNormalized,
            askPullNormalized,
          );

        /* HISTORY */

        const historyPoint:
          BookHistoryPoint =
          {
            timestamp:
              now,

            midPrice,

            bidVolume,
            askVolume,

            bestBidSize:
              bestBid?.size ??
              0,

            bestAskSize:
              bestAsk?.size ??
              0,

            bidWallPrice:
              bidWall?.price ??
              null,

            askWallPrice:
              askWall?.price ??
              null,

            bidWallSize:
              bidWall?.size ??
              0,

            askWallSize:
              askWall?.size ??
              0,

            bidWallAgeMs,
            askWallAgeMs,

            obi,

            bidAdd,
            askAdd,

            bidPull,
            askPull,
          };

        historyRef.current.push(
          historyPoint,
        );

        const historyCutoff =
          now -
          HISTORY_WINDOW_MS;

        historyRef.current =
          historyRef.current.filter(
            (
              point,
            ) =>
              point.timestamp >=
              historyCutoff,
          );

        /* ABSORPTION */

        const absorption =
          calculateAbsorption(
            historyRef.current,
          );

        /* REPLENISHMENT */

        const replenishment =
          calculateReplenishment(
            historyRef.current,
          );

        /* SPOOF */

        const spoofRisk =
          calculateSpoofRisk(
            removedLargeOrdersRef.current,
            now,
          );

        /* LIQUIDITY */

        const liquidityPressure =
          calculateLiquidityPressure(
            multiDepth,

            microPrice,
            midPrice,
            spread,

            bidPersistence,
            askPersistence,

            spoofRisk,
          );

        /* LARGE THRESHOLD */

        const largeThreshold =
          calculateLargeThreshold(
            internalBids,
            internalAsks,
          );

        largeThresholdRef.current =
          largeThreshold;

        /* HEATMAP */

        const snapshot =
          buildHeatmapSnapshot(
            internalBids,
            internalAsks,

            now,
            midPrice,

            largeThreshold,
          );

        heatmapRef.current =
          [
            ...heatmapRef.current,
            snapshot,
          ].slice(
            -MAX_HEATMAP_SNAPSHOTS,
          );

        const heatmapHistory =
          [
            ...heatmapRef.current,
          ];

        setHeatmap(
          heatmapHistory,
        );

        /* PUBLIC BOOK */

        setBids(
          internalBids.map(
            (
              level,
            ) =>
              toPublicLevel(
                level,
                now,
                largeThreshold,
              ),
          ),
        );

        setAsks(
          internalAsks.map(
            (
              level,
            ) =>
              toPublicLevel(
                level,
                now,
                largeThreshold,
              ),
          ),
        );

        /* DATA QUALITY */

        const sideQuality =
          internalBids.length >
            0 &&
          internalAsks.length >
            0
            ? 1
            : 0;

        const depthQuality =
          clamp(
            Math.min(
              internalBids.length,
              internalAsks.length,
            ) /
              Math.min(
                safeLimit,
                100,
              ),
            0,
            1,
          );

        const historyQuality =
          clamp(
            historyRef.current
              .length /
              20,
            0,
            1,
          );

        const sequenceQuality =
          sequenceHealthyRef.current
            ? 1
            : 0.25;

        const resyncQuality =
          resyncingRef.current
            ? 0.25
            : 1;

        /*
         * FIX:
         * read freshness from ref.
         */

        const lastBookUpdate =
          lastUpdatedAtRef.current;

        const bookAgeMs =
          lastBookUpdate ===
          null
            ? 0
            : Math.max(
                0,
                now -
                  lastBookUpdate,
              );

        const freshnessQuality =
          lastBookUpdate ===
          null
            ? 0
            : clamp(
                1 -
                  bookAgeMs /
                    STALE_AFTER_MS,
                0,
                1,
              );

        const dataQuality =
          clamp(
            (
              sideQuality *
                0.25 +
              depthQuality *
                0.20 +
              historyQuality *
                0.15 +
              sequenceQuality *
                0.20 +
              freshnessQuality *
                0.20
            ) *
              resyncQuality,
            0,
            1,
          );

        setMetrics({
          obi,

          orderFlow,

          liquidityPressure,

          bidVolume,
          askVolume,

          bidWallPrice:
            bidWall?.price ??
            null,

          askWallPrice:
            askWall?.price ??
            null,

          bidWallSize:
            bidWall?.size ??
            null,

          askWallSize:
            askWall?.size ??
            null,

          spread,

          microPrice,

          absorption,

          replenishment,

          spoofRisk,

          updatedAt:
            now,

          multiDepth,

          obi01,
          obi025,
          obi05,
          obi1,
          obi2,

          bidAdd,
          askAdd,

          bidPull,
          askPull,

          bidAddNormalized,
          askAddNormalized,

          bidPullNormalized,
          askPullNormalized,

          bidPersistence,
          askPersistence,

          bidWallAgeMs,
          askWallAgeMs,

          bidWallDistancePercent,
          askWallDistancePercent,

          microPriceBias,

          spreadPercent,

          heatmap:
            heatmapHistory,

          dataQuality,

          sequenceHealthy:
            sequenceHealthyRef.current,

          resyncing:
            resyncingRef.current,

          bookAgeMs,

          lastSequence:
            lastSequenceRef.current,

          gapCount:
            gapCountRef.current,
        });
      },
      [
        safeLimit,
      ],
    );

  /* =======================================================
     BATCH PUBLISH
     ======================================================= */

  const schedulePublish =
    useCallback(
      () => {
        if (
          publishTimerRef.current
        ) {
          return;
        }

        publishTimerRef.current =
          setTimeout(
            () => {
              publishTimerRef.current =
                null;

              if (
                !mountedRef.current
              ) {
                return;
              }

              publishBook();
            },
            PUBLISH_INTERVAL_MS,
          );
      },
      [
        publishBook,
      ],
    );

  /*   /* =======================================================
     CONNECTION
     LEX V2.4.3

     IMPORTANT FIX:
     loading = ONLY first load of a new market.

     REST snapshot available -> loading becomes false forever
     for the current generation.

     WS reconnect / resync MUST NOT turn loading back on.
     This prevents LOADING QNT_USDT from blinking and
     prevents the whole mobile layout from jumping.
     ======================================================= */

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setLoading(false);
      return;
    }

    if (
      !normalizedPair ||
      !normalizedPair.includes('_')
    ) {
      setError('Invalid Gate.io market pair.');
      setConnected(false);
      setLoading(false);
      return;
    }

    const generation =
      ++generationRef.current;

    let disposed = false;

    let snapshotController:
      AbortController | null = null;

    /*
     * IMPORTANT
     *
     * This is LOCAL to one market generation.
     *
     * false:
     * We still have no usable order book.
     *
     * true:
     * At least one REST snapshot or WS update has produced
     * usable data. From this point loading must NEVER become
     * true again for this market generation.
     */
    let hasUsableBook = false;

    /* =====================================================
       SAFE STATE HELPERS
       ===================================================== */

    const markInitialLoading = () => {
      if (
        disposed ||
        generation !== generationRef.current
      ) {
        return;
      }

      /*
       * Only the first load may show LOADING.
       */
      if (!hasUsableBook) {
        setLoading(true);
      }
    };

    const markBookReady = () => {
      if (
        disposed ||
        generation !== generationRef.current
      ) {
        return;
      }

      hasUsableBook = true;

      /*
       * CRITICAL:
       * Once usable data exists, loading stays false.
       */
      setLoading(false);
    };

    /* =====================================================
       RESET FOR A REAL MARKET CHANGE / MANUAL RELOAD
       ===================================================== */

    bidMapRef.current =
      new Map();

    askMapRef.current =
      new Map();

    historyRef.current =
      [];

    heatmapRef.current =
      [];

    deltaAccumulatorRef.current =
      emptyDeltaAccumulator();

    removedLargeOrdersRef.current =
      [];

    largeThresholdRef.current =
      Infinity;

    lastSequenceRef.current =
      null;

    sequenceHealthyRef.current =
      true;

    resyncingRef.current =
      false;

    gapCountRef.current =
      0;

    lastUpdatedAtRef.current =
      null;

    receivedLiveUpdateRef.current =
      false;

    setBids([]);
    setAsks([]);
    setMetrics(null);
    setHeatmap([]);

    setConnected(false);

    /*
     * This is the ONLY normal place where loading
     * becomes true.
     */
    setLoading(true);

    setError(null);
    setLastUpdatedAt(null);

    /* =====================================================
       CLEAR TIMERS
       ===================================================== */

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(
          reconnectTimerRef.current,
        );

        reconnectTimerRef.current =
          null;
      }
    };

    const clearResyncTimer = () => {
      if (resyncTimerRef.current) {
        clearTimeout(
          resyncTimerRef.current,
        );

        resyncTimerRef.current =
          null;
      }
    };

    /* =====================================================
       CLOSE SOCKET
       ===================================================== */

    const closeSocket = () => {
      const socket =
        socketRef.current;

      socketRef.current = null;

      if (!socket) {
        return;
      }

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      try {
        socket.close();
      } catch {
        // Ignore socket close errors.
      }
    };

    /* =====================================================
       RESYNC

       IMPORTANT:
       Resync happens silently when a book already exists.

       It MUST NOT:
       - clear visible bids/asks
       - display LOADING again
       - change page height
       ===================================================== */

    const resync =
      async (): Promise<boolean> => {
        if (
          disposed ||
          resyncingRef.current ||
          generation !== generationRef.current
        ) {
          return false;
        }

        resyncingRef.current = true;
        sequenceHealthyRef.current = false;

        /*
         * WS is temporarily not considered LIVE,
         * but visible order-book data stays on screen.
         */
        setConnected(false);

        /*
         * CRITICAL FIX:
         *
         * OLD:
         * setLoading(true);
         *
         * NEW:
         * Only show loading if absolutely no usable
         * book has ever been received.
         */
        if (!hasUsableBook) {
          markInitialLoading();
        }

        snapshotController?.abort();

        const controller =
          new AbortController();

        snapshotController =
          controller;

        try {
          const snapshot =
            await fetchOrderBookSnapshot({
              pair: normalizedPair,
              limit: safeLimit,
              signal: controller.signal,
            });

          if (
            disposed ||
            generation !== generationRef.current
          ) {
            return false;
          }

          applySnapshot(
            bidMapRef.current,
            snapshot.bids,
            snapshot.timestamp,
          );

          applySnapshot(
            askMapRef.current,
            snapshot.asks,
            snapshot.timestamp,
          );

          lastSequenceRef.current =
            snapshot.sequence;

          lastUpdatedAtRef.current =
            snapshot.timestamp;

          setLastUpdatedAt(
            snapshot.timestamp,
          );

          sequenceHealthyRef.current =
            true;

          /*
           * A fresh REST snapshot invalidates the old
           * accumulated delta/history, but NOT the visible
           * React layout.
           */
          deltaAccumulatorRef.current =
            emptyDeltaAccumulator();

          historyRef.current = [];
          heatmapRef.current = [];

          removedLargeOrdersRef.current =
            [];

          resyncingRef.current =
            false;

          setError(null);

          /*
           * Publish the replacement snapshot.
           */
          publishBook();

          /*
           * CRITICAL:
           * REST data is usable.
           *
           * Stop LOADING and never bring it back during
           * reconnect/resync for this generation.
           */
          markBookReady();

          return true;
        } catch (cause) {
          if (
            disposed ||
            controller.signal.aborted ||
            generation !== generationRef.current
          ) {
            return false;
          }

          resyncingRef.current =
            false;

          sequenceHealthyRef.current =
            false;

          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to resynchronize Gate.io order book.',
          );

          /*
           * CRITICAL:
           *
           * If old book data is still visible, do NOT
           * switch loading on/off.
           */
          if (hasUsableBook) {
            setLoading(false);
          } else {
            setLoading(false);
          }

          return false;
        }
      };

    /* =====================================================
       SCHEDULE RESYNC
       ===================================================== */

    const scheduleResync = () => {
      if (
        disposed ||
        resyncTimerRef.current
      ) {
        return;
      }

      resyncTimerRef.current =
        setTimeout(
          () => {
            resyncTimerRef.current =
              null;

            void resync();
          },
          RESYNC_DELAY_MS,
        );
    };

    /* =====================================================
       SEQUENCE VALIDATION
       ===================================================== */

    const validateSequence = (
      first: number | null,
      last: number | null,
    ): boolean => {
      const previous =
        lastSequenceRef.current;

      /*
       * Gate did not provide sequence information.
       * Do not reject an otherwise valid update.
       */
      if (last === null) {
        return true;
      }

      /*
       * First WS sequence after initialization.
       */
      if (previous === null) {
        lastSequenceRef.current =
          last;

        sequenceHealthyRef.current =
          true;

        return true;
      }

      /*
       * Duplicate / old event.
       *
       * Ignore it, but do NOT start a resync loop.
       */
      if (last <= previous) {
        return false;
      }

      if (first !== null) {
        const expected =
          previous + 1;

        /*
         * The expected sequence must fall inside
         * [first, last].
         */
        if (
          expected < first ||
          expected > last
        ) {
          gapCountRef.current += 1;

          sequenceHealthyRef.current =
            false;

          scheduleResync();

          return false;
        }
      }

      lastSequenceRef.current =
        last;

      sequenceHealthyRef.current =
        true;

      return true;
    };

    /* =====================================================
       SOCKET
       ===================================================== */

    const connectSocket = () => {
      if (
        disposed ||
        generation !== generationRef.current
      ) {
        return;
      }

      closeSocket();

      receivedLiveUpdateRef.current =
        false;

      setConnected(false);

      /*
       * IMPORTANT:
       *
       * Reconnecting the WebSocket is NOT equivalent to
       * loading the whole market again.
       */
      if (hasUsableBook) {
        setLoading(false);
      }

      const socket =
        new WebSocket(
          GATE_WS_URL,
        );

      socketRef.current =
        socket;

      /* ===================================================
         OPEN
         =================================================== */

      socket.onopen = () => {
        if (
          disposed ||
          generation !== generationRef.current
        ) {
          try {
            socket.close();
          } catch {
            // Ignore.
          }

          return;
        }

        try {
          socket.send(
            JSON.stringify({
              time:
                Math.floor(
                  Date.now() / 1000,
                ),

              channel:
                'spot.order_book_update',

              event:
                'subscribe',

              payload: [
                normalizedPair,
                updateInterval,
              ],
            }),
          );
        } catch {
          setError(
            'Unable to subscribe to Gate.io Level-2.',
          );

          /*
           * Never resurrect LOADING if REST data exists.
           */
          if (hasUsableBook) {
            setLoading(false);
          }

          return;
        }

        /*
         * socket.onopen means transport connected.
         *
         * connected remains FALSE until a real
         * Level-2 update arrives.
         *
         * But if REST snapshot exists, loading is already
         * FALSE.
         */
        if (hasUsableBook) {
          setLoading(false);
        }
      };

      /* ===================================================
         MESSAGE
         =================================================== */

      socket.onmessage = (
        event,
      ) => {
        if (
          disposed ||
          generation !== generationRef.current
        ) {
          return;
        }

        let message:
          GateWsMessage;

        try {
          message =
            JSON.parse(
              event.data,
            ) as GateWsMessage;
        } catch {
          return;
        }

        if (message.error) {
          setConnected(false);

          setError(
            'Gate.io WebSocket returned an error.',
          );

          /*
           * Existing snapshot remains visible.
           */
          if (hasUsableBook) {
            setLoading(false);
          }

          return;
        }

        if (
          message.channel !==
            'spot.order_book_update' ||
          message.event !==
            'update'
        ) {
          return;
        }

        if (
          !message.result ||
          typeof message.result !==
            'object'
        ) {
          return;
        }

        const result =
          message.result as GateWsBookResult;

        const symbol =
          typeof result.s === 'string'
            ? result.s
            : null;

        if (
          symbol &&
          symbol !== normalizedPair
        ) {
          return;
        }

        /* =================================================
           SEQUENCE
           ================================================= */

        const firstSequenceRaw =
          toFiniteNumber(
            result.U,
          );

        const lastSequenceRaw =
          toFiniteNumber(
            result.u,
          );

        const firstSequence =
          firstSequenceRaw === null
            ? null
            : Math.floor(
                firstSequenceRaw,
              );

        const lastSequence =
          lastSequenceRaw === null
            ? null
            : Math.floor(
                lastSequenceRaw,
              );

        if (
          !validateSequence(
            firstSequence,
            lastSequence,
          )
        ) {
          return;
        }

        /* =================================================
           LEVELS
           ================================================= */

        const bidUpdates =
          parseLevels(
            result.b ??
              result.bids,
          );

        const askUpdates =
          parseLevels(
            result.a ??
              result.asks,
          );

        if (
          bidUpdates.length === 0 &&
          askUpdates.length === 0
        ) {
          return;
        }

        const timestamp =
          normalizeTimestamp(
            result.t ??
              result.E ??
              result.e ??
              message.time_ms ??
              message.time,
          );

        const bidsBefore =
          new Map(
            bidMapRef.current,
          );

        const asksBefore =
          new Map(
            askMapRef.current,
          );

        const bidChanges =
          applyDelta(
            bidMapRef.current,
            bidUpdates,
            timestamp,
          );

        const askChanges =
          applyDelta(
            askMapRef.current,
            askUpdates,
            timestamp,
          );

        registerRemovedOrders(
          'bid',
          bidChanges,
          bidsBefore,
          timestamp,
        );

        registerRemovedOrders(
          'ask',
          askChanges,
          asksBefore,
          timestamp,
        );

        accumulateDelta(
          deltaAccumulatorRef.current,
          'bid',
          bidChanges,
        );

        accumulateDelta(
          deltaAccumulatorRef.current,
          'ask',
          askChanges,
        );

        /* =================================================
           FRESHNESS
           ================================================= */

        lastUpdatedAtRef.current =
          timestamp;

        setLastUpdatedAt(
          timestamp,
        );

        /*
         * WS data itself is also usable.
         */
        markBookReady();

        /* =================================================
           FIRST REAL LIVE UPDATE
           ================================================= */

        if (
          !receivedLiveUpdateRef.current
        ) {
          receivedLiveUpdateRef.current =
            true;

          setConnected(true);

          setError(null);
        }

        schedulePublish();
      };

      /* ===================================================
         ERROR
         =================================================== */

      socket.onerror = () => {
        if (
          disposed ||
          generation !== generationRef.current
        ) {
          return;
        }

        setConnected(false);

        receivedLiveUpdateRef.current =
          false;

        setError(
          'Gate.io Level-2 WebSocket connection error.',
        );

        /*
         * CRITICAL:
         * Do not show LOADING during a WS problem when
         * REST/order-book data already exists.
         */
        if (hasUsableBook) {
          setLoading(false);
        }
      };

      /* ===================================================
         CLOSE
         =================================================== */

      socket.onclose = () => {
        if (
          disposed ||
          generation !== generationRef.current
        ) {
          return;
        }

        /*
         * Ignore close event from a socket that is no
         * longer the active socket.
         */
        if (
          socketRef.current !== socket
        ) {
          return;
        }

        socketRef.current = null;

        setConnected(false);

        receivedLiveUpdateRef.current =
          false;

        sequenceHealthyRef.current =
          false;

        /*
         * CRITICAL:
         * Keep the existing book on screen.
         */
        if (hasUsableBook) {
          setLoading(false);
        }

        clearReconnectTimer();

        reconnectTimerRef.current =
          setTimeout(
            async () => {
              reconnectTimerRef.current =
                null;

              if (
                disposed ||
                generation !== generationRef.current
              ) {
                return;
              }

              /*
               * Controlled recovery:
               *
               * 1. REST refresh
               * 2. WebSocket reconnect
               *
               * All of this happens WITHOUT flashing
               * LOADING if old data exists.
               */
              await resync();

              if (
                disposed ||
                generation !== generationRef.current
              ) {
                return;
              }

              connectSocket();
            },
            RECONNECT_DELAY_MS,
          );
      };
    };

    /* =====================================================
       INITIALIZE
       ===================================================== */

    const initialize =
      async () => {
        const controller =
          new AbortController();

        snapshotController =
          controller;

        try {
          const snapshot =
            await fetchOrderBookSnapshot({
              pair:
                normalizedPair,

              limit:
                safeLimit,

              signal:
                controller.signal,
            });

          if (
            disposed ||
            generation !== generationRef.current
          ) {
            return;
          }

          applySnapshot(
            bidMapRef.current,
            snapshot.bids,
            snapshot.timestamp,
          );

          applySnapshot(
            askMapRef.current,
            snapshot.asks,
            snapshot.timestamp,
          );

          lastSequenceRef.current =
            snapshot.sequence;

          sequenceHealthyRef.current =
            true;

          lastUpdatedAtRef.current =
            snapshot.timestamp;

          setLastUpdatedAt(
            snapshot.timestamp,
          );

          /*
           * Publish REST snapshot immediately.
           */
          publishBook();

          /*
           * THIS is the important transition:
           *
           * LOADING -> OFF
           *
           * It will not return during normal WS reconnects
           * or resyncs.
           */
          markBookReady();

          /*
           * REST != WS LIVE.
           */
          setConnected(false);

          /*
           * Start Level-2 stream.
           */
          connectSocket();
        } catch (cause) {
          if (
            disposed ||
            controller.signal.aborted ||
            generation !== generationRef.current
          ) {
            return;
          }

          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load Gate.io order book.',
          );

          /*
           * REST failed.
           *
           * Stop the full-screen/row loading state instead
           * of allowing it to flash indefinitely.
           *
           * WS can still recover the book.
           */
          setLoading(false);

          connectSocket();
        }
      };

    void initialize();

    /* =====================================================
       STALE WATCH

       Stale WS data does NOT mean UI loading.
       It only means LIVE connection is temporarily unhealthy.
       ===================================================== */

    const staleTimer =
      setInterval(
        () => {
          if (
            disposed ||
            generation !== generationRef.current
          ) {
            return;
          }

          const lastUpdate =
            lastUpdatedAtRef.current;

          if (
            lastUpdate === null
          ) {
            return;
          }

          const age =
            Date.now() -
            lastUpdate;

          if (
            age <= STALE_AFTER_MS
          ) {
            return;
          }

          if (
            receivedLiveUpdateRef.current
          ) {
            receivedLiveUpdateRef.current =
              false;

            setConnected(false);
          }

          sequenceHealthyRef.current =
            false;

          /*
           * CRITICAL:
           *
           * OLD BEHAVIOUR:
           * stale -> resync -> loading=true -> UI jumps
           *
           * NEW BEHAVIOUR:
           * stale -> silent resync -> visible book remains
           */
          if (hasUsableBook) {
            setLoading(false);
          }

          scheduleResync();
        },
        3000,
      );

    /* =====================================================
       CLEANUP
       ===================================================== */

    return () => {
      disposed = true;

      snapshotController?.abort();

      clearInterval(
        staleTimer,
      );

      clearReconnectTimer();
      clearResyncTimer();

      if (
        publishTimerRef.current
      ) {
        clearTimeout(
          publishTimerRef.current,
        );

        publishTimerRef.current =
          null;
      }

      closeSocket();

      receivedLiveUpdateRef.current =
        false;

      /*
       * Do not perform unnecessary state updates here.
       * The next generation will initialize its own state.
       */
    };
  }, [
    enabled,
    normalizedPair,
    publishBook,
    registerRemovedOrders,
    reloadToken,
    safeLimit,
    schedulePublish,
    updateInterval,
  ]);
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
     LIVE MID PRICE
     ======================================================= */

  const lastPrice =
    useMemo(
      () => {
        const bestBid =
          bids[0]?.price ??
          null;

        const bestAsk =
          asks[0]?.price ??
          null;

        if (
          bestBid !==
            null &&
          bestAsk !==
            null
        ) {
          return (
            bestBid +
            bestAsk
          ) / 2;
        }

        return (
          bestBid ??
          bestAsk
        );
      },
      [
        asks,
        bids,
      ],
    );

  /* =======================================================
     RESULT
     ======================================================= */

  return {
    bids,

    asks,

    lastPrice,

    metrics,

    heatmap,

    connected,

    loading,

    error,

    lastUpdatedAt,

    reload,
  };
}

export default useGateOrderBook;