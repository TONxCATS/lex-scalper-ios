import type {
  BookState,
  BookUpdateSource,
  MarketTrade,
} from '@/hooks/use-market-stream';

const FLOW_WINDOW_MS = 5_000;
const SPOOF_WINDOW_MS = 30_000;
const TRADE_MATCH_WINDOW_MS = 650;
const LEVEL_EPSILON = 1e-9;
const DEPTH_BANDS = [
  { label: '0.1%', basisPoints: 10 },
  { label: '0.25%', basisPoints: 25 },
  { label: '0.5%', basisPoints: 50 },
  { label: '1%', basisPoints: 100 },
] as const;

export type BookSide = 'bid' | 'ask';
export type TradePressure = 'buy' | 'sell';

export type TrackedWall = {
  price: number;
  size: number;
  persistenceMs: number;
} | null;

export type TrackedLevelAge = {
  side: BookSide;
  price: number;
  size: number;
  ageMs: number;
} | null;

export type SweepSignal = {
  side: TradePressure;
  levels: number;
  amount: number;
  at: number;
};

export type OrderBookHistoryMetrics = {
  baselineReady: boolean;
  obi: Record<(typeof DEPTH_BANDS)[number]['label'], number | null>;
  microprice: number | null;
  buyPressure: number | null;
  added: number;
  pulled: number;
  replenishment: number;
  absorption: number;
  spoofRisk: number;
  sweep: SweepSignal | null;
  bidWall: TrackedWall;
  askWall: TrackedWall;
  oldestLevel: TrackedLevelAge;
  largeThresholds: { bid: number; ask: number };
  wallThresholds: { bid: number; ask: number };
};

type FlowEvent = {
  at: number;
  added: number;
  pulled: number;
  replenishment: number;
  absorption: number;
};

type TradeRecord = {
  id: string;
  side: TradePressure;
  price: number;
  amount: number;
  receivedAt: number;
  remainingAmount: number;
};

type PendingRemoval = {
  side: BookSide;
  price: number;
  removed: number;
  matched: number;
  remaining: number;
  previousSize: number;
  currentSize: number;
  createdAt: number;
  wallAgeMs: number;
  wasWall: boolean;
};

type ActiveWall = {
  since: number;
  size: number;
};

type WallRemoval = {
  at: number;
  total: number;
  suspiciousPull: number;
};

type DynamicThreshold = {
  large: number;
  wall: number;
};

const EMPTY_METRICS: OrderBookHistoryMetrics = {
  baselineReady: false,
  obi: {
    '0.1%': null,
    '0.25%': null,
    '0.5%': null,
    '1%': null,
  },
  microprice: null,
  buyPressure: null,
  added: 0,
  pulled: 0,
  replenishment: 0,
  absorption: 0,
  spoofRisk: 0,
  sweep: null,
  bidWall: null,
  askWall: null,
  oldestLevel: null,
  largeThresholds: {
    bid: Number.POSITIVE_INFINITY,
    ask: Number.POSITIVE_INFINITY,
  },
  wallThresholds: {
    bid: Number.POSITIVE_INFINITY,
    ask: Number.POSITIVE_INFINITY,
  },
};

function priceKey(price: number) {
  return price.toFixed(8);
}

function levelKey(side: BookSide, price: number) {
  return `${side}:${priceKey(price)}`;
}

function dynamicThreshold(sizes: number[]): DynamicThreshold {
  const sorted = sizes.filter((size) => size > 0 && Number.isFinite(size)).sort((a, b) => a - b);
  if (sorted.length < 4) {
    return { large: Number.POSITIVE_INFINITY, wall: Number.POSITIVE_INFINITY };
  }
  const quantile = (ratio: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  const median = quantile(0.5);
  const upperQuartile = quantile(0.75);
  const upperDecile = quantile(0.9);
  const large = Math.max(median * 2.6, upperQuartile * 1.8, upperDecile * 1.08);
  return { large, wall: large * 1.35 };
}

function thresholdsFor(book: BookState) {
  return {
    bid: dynamicThreshold(book.bids.map((level) => level.size)),
    ask: dynamicThreshold(book.asks.map((level) => level.size)),
  };
}

function levelMap(book: BookState, side: BookSide) {
  const levels = side === 'bid' ? book.bids : book.asks;
  return new Map(levels.map((level) => [priceKey(level.price), level.size]));
}

function topEdge(book: BookState, side: BookSide): number | null {
  const levels = side === 'bid' ? book.bids : book.asks;
  return levels.length ? levels[levels.length - 1].price : null;
}

function midPrice(book: BookState) {
  if (book.bestBid === null || book.bestAsk === null) return null;
  return (book.bestBid + book.bestAsk) / 2;
}

function tradeBookSide(tradeSide: TradePressure): BookSide {
  return tradeSide === 'buy' ? 'ask' : 'bid';
}

function matchedDepthEffects(
  previousSize: number,
  currentSize: number,
  executedAmount: number,
) {
  const expectedAfterExecution = Math.max(0, previousSize - executedAmount);
  const replenishment = Math.min(
    executedAmount,
    Math.max(0, currentSize - expectedAfterExecution),
  );
  const absorption = currentSize > 0 || replenishment > 0 ? executedAmount : 0;
  return { replenishment, absorption };
}

function emptyFlowEvent(at: number): FlowEvent {
  return { at, added: 0, pulled: 0, replenishment: 0, absorption: 0 };
}

export class OrderBookHistoryEngine {
  private latestBook: BookState | null = null;
  private previousBook: BookState | null = null;
  private baselineReady = false;
  private samples = 0;
  private flowEvents: FlowEvent[] = [];
  private trades: TradeRecord[] = [];
  private tradesSinceBook: TradeRecord[] = [];
  private pendingRemovals: PendingRemoval[] = [];
  private activeLevels = new Map<string, ActiveWall>();
  private wallRemovals: WallRemoval[] = [];
  private sweeps: SweepSignal[] = [];
  private seenTradeIds = new Map<string, number>();

  reset(): OrderBookHistoryMetrics {
    this.latestBook = null;
    this.previousBook = null;
    this.baselineReady = false;
    this.samples = 0;
    this.flowEvents = [];
    this.trades = [];
    this.tradesSinceBook = [];
    this.pendingRemovals = [];
    this.activeLevels.clear();
    this.wallRemovals = [];
    this.sweeps = [];
    this.seenTradeIds.clear();
    return EMPTY_METRICS;
  }

  processTrade(trade: MarketTrade, receivedAt: number): OrderBookHistoryMetrics {
    if (
      trade.amount <= 0 ||
      trade.price <= 0 ||
      !Number.isFinite(trade.amount) ||
      !Number.isFinite(trade.price)
    ) {
      return this.metricsAt(receivedAt);
    }

    if (trade.id && this.seenTradeIds.has(trade.id)) {
      return this.metricsAt(receivedAt);
    }
    if (trade.id) this.seenTradeIds.set(trade.id, receivedAt);

    const record: TradeRecord = {
      ...trade,
      receivedAt,
      remainingAmount: trade.amount,
    };
    this.trades.push(record);
    this.tradesSinceBook.push(record);
    this.matchTradeToPending(record, receivedAt);
    this.finalizeExpiredRemovals(receivedAt);
    this.prune(receivedAt);
    return this.metricsAt(receivedAt);
  }

  processBook(
    book: BookState,
    source: BookUpdateSource,
    receivedAt: number,
  ): OrderBookHistoryMetrics {
    this.latestBook = book;
    this.finalizeExpiredRemovals(receivedAt);
    this.prune(receivedAt);
    const currentThresholds = thresholdsFor(book);

    if (source === 'snapshot') {
      this.previousBook = book;
      this.refreshActiveLevels(book, receivedAt);
      return this.metricsAt(receivedAt, currentThresholds);
    }

    const previous = this.previousBook;
    if (!previous || !this.baselineReady) {
      this.previousBook = book;
      this.baselineReady = true;
      this.tradesSinceBook = [];
      this.refreshActiveLevels(book, receivedAt);
      return this.metricsAt(receivedAt, currentThresholds);
    }

    const previousThresholds = thresholdsFor(previous);
    const intervalTrades = this.tradesSinceBook.filter(
      (trade) => receivedAt - trade.receivedAt <= TRADE_MATCH_WINDOW_MS,
    );
    this.tradesSinceBook = [];
    const tradesByLevel = new Map<string, TradeRecord[]>();
    for (const trade of intervalTrades) {
      const key = levelKey(tradeBookSide(trade.side), trade.price);
      const grouped = tradesByLevel.get(key) ?? [];
      grouped.push(trade);
      tradesByLevel.set(key, grouped);
    }

    this.refreshPendingDepth(book);
    for (const trade of intervalTrades) {
      this.matchTradeToPending(trade, receivedAt);
    }

    const previousMid = midPrice(previous);
    const currentMid = midPrice(book);
    for (const side of ['bid', 'ask'] as const) {
      const previousLevels = levelMap(previous, side);
      const currentLevels = levelMap(book, side);
      const previousEdge = topEdge(previous, side);
      const currentEdge = topEdge(book, side);
      const prices = new Set([...previousLevels.keys(), ...currentLevels.keys()]);

      for (const key of prices) {
        const price = Number(key);
        const previousSize = previousLevels.get(key) ?? 0;
        const currentSize = currentLevels.get(key) ?? 0;
        const removedFromSnapshot =
          previousSize > 0 &&
          currentSize === 0 &&
          ((side === 'bid' && currentEdge !== null && price < currentEdge) ||
            (side === 'ask' && currentEdge !== null && price > currentEdge));
        const enteredAtPreviousEdge =
          previousSize === 0 &&
          currentSize > 0 &&
          ((side === 'bid' && previousEdge !== null && price < previousEdge) ||
            (side === 'ask' && previousEdge !== null && price > previousEdge));
        if (removedFromSnapshot || enteredAtPreviousEdge) continue;

        const levelTrades = tradesByLevel.get(levelKey(side, price)) ?? [];
        const observedTradeAmount = levelTrades.reduce(
          (sum, trade) => sum + trade.remainingAmount,
          0,
        );
        const delta = currentSize - previousSize;
        if (delta > LEVEL_EPSILON) {
          this.addFlow(receivedAt, { added: delta });
        }

        if (observedTradeAmount > LEVEL_EPSILON && currentSize > 0) {
          const directExecution = Math.min(
            observedTradeAmount,
            Math.max(0, previousSize - currentSize),
          );
          const excessExecution = Math.max(0, observedTradeAmount - directExecution);
          if (directExecution > 0) {
            this.addExecutionEffects(previousSize, currentSize, directExecution, receivedAt);
          }
          if (excessExecution > 0) {
            this.addExecutionEffects(previousSize, currentSize, excessExecution, receivedAt);
          }
        }

        if (delta < -LEVEL_EPSILON) {
          const removed = -delta;
          const directlyMatched = Math.min(removed, observedTradeAmount);
          const unmatched = Math.max(0, removed - directlyMatched);
          const previousWallThreshold = previousThresholds[side].wall;
          const activeLevel = this.activeLevels.get(levelKey(side, price));
          const wasWall = previousSize >= previousWallThreshold;
          if (unmatched > LEVEL_EPSILON) {
            this.pendingRemovals.push({
              side,
              price,
              removed,
              matched: directlyMatched,
              remaining: unmatched,
              previousSize,
              currentSize,
              createdAt: receivedAt,
              wallAgeMs: activeLevel ? receivedAt - activeLevel.since : 0,
              wasWall,
            });
          } else if (wasWall) {
            this.recordWallRemoval(receivedAt, removed, 0, false);
          }
        }

        for (const trade of levelTrades) {
          trade.remainingAmount = 0;
        }
      }
    }

    this.detectSweeps(previous, book, intervalTrades, receivedAt);
    this.previousBook = book;
    this.samples += 1;
    this.refreshActiveLevels(book, receivedAt);
    this.finalizeExpiredRemovals(receivedAt);
    this.prune(receivedAt);
    return this.metricsAt(receivedAt, currentThresholds);
  }

  private addExecutionEffects(
    previousSize: number,
    currentSize: number,
    executedAmount: number,
    at: number,
  ) {
    const effects = matchedDepthEffects(previousSize, currentSize, executedAmount);
    this.addFlow(at, effects);
  }

  private matchTradeToPending(trade: TradeRecord, now: number) {
    if (trade.remainingAmount <= LEVEL_EPSILON) return;
    const side = tradeBookSide(trade.side);
    for (const pending of this.pendingRemovals) {
      if (
        pending.side !== side ||
        priceKey(pending.price) !== priceKey(trade.price) ||
        now - pending.createdAt > TRADE_MATCH_WINDOW_MS ||
        trade.remainingAmount <= LEVEL_EPSILON
      ) {
        continue;
      }

      const matched = Math.min(pending.remaining, trade.remainingAmount);
      if (matched <= LEVEL_EPSILON) continue;
      pending.remaining -= matched;
      pending.matched += matched;
      trade.remainingAmount -= matched;
      if (pending.currentSize > 0) {
        this.addFlow(now, {
          replenishment: Math.min(matched, pending.currentSize),
          absorption: matched,
        });
      }
    }
  }

  private refreshPendingDepth(book: BookState) {
    for (const pending of this.pendingRemovals) {
      const levels = pending.side === 'bid' ? book.bids : book.asks;
      const current = levels.find(
        (level) => priceKey(level.price) === priceKey(pending.price),
      );
      pending.currentSize = current?.size ?? 0;
    }
  }

  private finalizeExpiredRemovals(now: number) {
    const keep: PendingRemoval[] = [];
    for (const pending of this.pendingRemovals) {
      if (
        pending.remaining <= LEVEL_EPSILON ||
        now - pending.createdAt > TRADE_MATCH_WINDOW_MS
      ) {
        const pulled = Math.max(0, pending.remaining);
        if (pulled > LEVEL_EPSILON) {
          this.addFlow(now, { pulled });
        }
        const rapidlyDisappeared =
          pending.wasWall &&
          pending.wallAgeMs <= 3_000 &&
          pending.remaining / Math.max(pending.removed, LEVEL_EPSILON) >= 0.65 &&
          pending.currentSize <= pending.previousSize * 0.25;
        if (pending.wasWall) {
          this.recordWallRemoval(
            now,
            pending.removed,
            rapidlyDisappeared ? pulled : 0,
            rapidlyDisappeared,
          );
        }
      } else {
        keep.push(pending);
      }
    }
    this.pendingRemovals = keep;
  }

  private recordWallRemoval(
    at: number,
    total: number,
    suspiciousPull: number,
    suspicious: boolean,
  ) {
    this.wallRemovals.push({
      at,
      total,
      suspiciousPull: suspicious ? suspiciousPull : 0,
    });
  }

  private refreshActiveLevels(book: BookState, now: number) {
    const next = new Map<string, ActiveWall>();
    for (const side of ['bid', 'ask'] as const) {
      const levels = side === 'bid' ? book.bids : book.asks;
      for (const level of levels) {
        const key = levelKey(side, level.price);
        const previous = this.activeLevels.get(key);
        next.set(key, {
          since: previous?.since ?? now,
          size: level.size,
        });
      }
    }
    this.activeLevels = next;
  }

  private detectSweeps(
    previous: BookState,
    current: BookState,
    trades: TradeRecord[],
    at: number,
  ) {
    const buyLevels = new Set<string>();
    const sellLevels = new Set<string>();
    let buyAmount = 0;
    let sellAmount = 0;

    for (const trade of trades) {
      if (trade.side === 'buy') {
        buyLevels.add(priceKey(trade.price));
        buyAmount += trade.amount;
      } else {
        sellLevels.add(priceKey(trade.price));
        sellAmount += trade.amount;
      }
    }

    const highestBuy = Math.max(
      0,
      ...trades.filter((trade) => trade.side === 'buy').map((trade) => trade.price),
    );
    const lowestSell = Math.min(
      Number.POSITIVE_INFINITY,
      ...trades.filter((trade) => trade.side === 'sell').map((trade) => trade.price),
    );
    if (
      buyLevels.size >= 2 &&
      buyAmount > 0 &&
      previous.bestAsk !== null &&
      current.bestAsk !== null &&
      (current.bestAsk > previous.bestAsk || highestBuy >= previous.bestAsk)
    ) {
      this.sweeps.push({
        side: 'buy',
        levels: buyLevels.size,
        amount: buyAmount,
        at,
      });
    }
    if (
      sellLevels.size >= 2 &&
      sellAmount > 0 &&
      previous.bestBid !== null &&
      current.bestBid !== null &&
      (current.bestBid < previous.bestBid || lowestSell <= previous.bestBid)
    ) {
      this.sweeps.push({
        side: 'sell',
        levels: sellLevels.size,
        amount: sellAmount,
        at,
      });
    }

  }

  private addFlow(at: number, delta: Partial<Omit<FlowEvent, 'at'>>) {
    const event = { ...emptyFlowEvent(at), ...delta };
    if (
      event.added <= 0 &&
      event.pulled <= 0 &&
      event.replenishment <= 0 &&
      event.absorption <= 0
    ) {
      return;
    }
    this.flowEvents.push(event);
  }

  private prune(now: number) {
    this.flowEvents = this.flowEvents.filter((event) => now - event.at <= FLOW_WINDOW_MS);
    this.trades = this.trades.filter((trade) => now - trade.receivedAt <= FLOW_WINDOW_MS);
    this.tradesSinceBook = this.tradesSinceBook.filter(
      (trade) => now - trade.receivedAt <= TRADE_MATCH_WINDOW_MS,
    );
    this.pendingRemovals = this.pendingRemovals.filter(
      (pending) => now - pending.createdAt <= TRADE_MATCH_WINDOW_MS,
    );
    this.wallRemovals = this.wallRemovals.filter(
      (event) => now - event.at <= SPOOF_WINDOW_MS,
    );
    this.sweeps = this.sweeps.filter((sweep) => now - sweep.at <= FLOW_WINDOW_MS);
    for (const [id, seenAt] of this.seenTradeIds) {
      if (now - seenAt > SPOOF_WINDOW_MS) this.seenTradeIds.delete(id);
    }
  }

  private metricsAt(
    now: number,
    thresholds = this.latestBook ? thresholdsFor(this.latestBook) : thresholdsForEmptyBook(),
  ): OrderBookHistoryMetrics {
    const book = this.latestBook;
    if (!book) return EMPTY_METRICS;
    const mid = midPrice(book);
    const obi: OrderBookHistoryMetrics['obi'] = {
      '0.1%': null,
      '0.25%': null,
      '0.5%': null,
      '1%': null,
    };

    if (mid !== null) {
      for (const band of DEPTH_BANDS) {
        const lowerBound = mid * (1 - band.basisPoints / 10_000);
        const upperBound = mid * (1 + band.basisPoints / 10_000);
        const bidEdge = topEdge(book, 'bid');
        const askEdge = topEdge(book, 'ask');
        const fullyCovered =
          bidEdge !== null &&
          askEdge !== null &&
          bidEdge <= lowerBound &&
          askEdge >= upperBound;
        if (!fullyCovered) continue;
        const bidSize = book.bids
          .filter((level) => level.price >= lowerBound)
          .reduce((sum, level) => sum + level.size, 0);
        const askSize = book.asks
          .filter((level) => level.price <= upperBound)
          .reduce((sum, level) => sum + level.size, 0);
        const total = bidSize + askSize;
        obi[band.label] = total > 0 ? ((bidSize - askSize) / total) * 100 : null;
      }
    }

    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    const microprice =
      bestBid && bestAsk && bestBid.size + bestAsk.size > 0
        ? (bestAsk.price * bestBid.size + bestBid.price * bestAsk.size) /
          (bestBid.size + bestAsk.size)
        : null;

    const rollingFlow = this.flowEvents.filter(
      (event) => now - event.at <= FLOW_WINDOW_MS,
    );
    const added = rollingFlow.reduce((sum, event) => sum + event.added, 0);
    const pulled = rollingFlow.reduce((sum, event) => sum + event.pulled, 0);
    const replenishment = rollingFlow.reduce(
      (sum, event) => sum + event.replenishment,
      0,
    );
    const absorption = rollingFlow.reduce((sum, event) => sum + event.absorption, 0);
    const rollingTrades = this.trades.filter(
      (trade) => now - trade.receivedAt <= FLOW_WINDOW_MS,
    );
    const buyVolume = rollingTrades
      .filter((trade) => trade.side === 'buy')
      .reduce((sum, trade) => sum + trade.amount, 0);
    const sellVolume = rollingTrades
      .filter((trade) => trade.side === 'sell')
      .reduce((sum, trade) => sum + trade.amount, 0);
    const totalTradeVolume = buyVolume + sellVolume;
    const largeWallRemoved = this.wallRemovals.reduce(
      (sum, event) => sum + event.total,
      0,
    );
    const suspiciousWallPull = this.wallRemovals.reduce(
      (sum, event) => sum + event.suspiciousPull,
      0,
    );
    const spoofRisk =
      largeWallRemoved > 0
        ? Math.min(100, (suspiciousWallPull / largeWallRemoved) * 100)
        : 0;

    return {
      baselineReady: this.baselineReady && this.samples > 0,
      obi,
      microprice,
      buyPressure:
        totalTradeVolume > 0 ? (buyVolume / totalTradeVolume) * 100 : null,
      added,
      pulled,
      replenishment,
      absorption,
      spoofRisk,
      sweep: this.sweeps.length ? this.sweeps[this.sweeps.length - 1] : null,
      bidWall: this.wallAt('bid', book, thresholds.bid.wall, now),
      askWall: this.wallAt('ask', book, thresholds.ask.wall, now),
      oldestLevel: this.oldestLevelAt(book, now),
      largeThresholds: {
        bid: thresholds.bid.large,
        ask: thresholds.ask.large,
      },
      wallThresholds: {
        bid: thresholds.bid.wall,
        ask: thresholds.ask.wall,
      },
    };
  }

  private wallAt(
    side: BookSide,
    book: BookState,
    threshold: number,
    now: number,
  ): TrackedWall {
    const levels = side === 'bid' ? book.bids : book.asks;
    const wall = levels
      .filter((level) => level.size >= threshold)
      .sort((a, b) => b.size - a.size)[0];
    if (!wall) return null;
    const active = this.activeLevels.get(levelKey(side, wall.price));
    return {
      price: wall.price,
      size: wall.size,
      persistenceMs: active ? Math.max(0, now - active.since) : 0,
    };
  }

  private oldestLevelAt(book: BookState, now: number): TrackedLevelAge {
    let oldest: TrackedLevelAge = null;
    for (const side of ['bid', 'ask'] as const) {
      const levels = side === 'bid' ? book.bids : book.asks;
      for (const level of levels) {
        const active = this.activeLevels.get(levelKey(side, level.price));
        const ageMs = active ? Math.max(0, now - active.since) : 0;
        if (!oldest || ageMs > oldest.ageMs) {
          oldest = { side, price: level.price, size: level.size, ageMs };
        }
      }
    }
    return oldest;
  }
}

function thresholdsForEmptyBook() {
  return {
    bid: { large: Number.POSITIVE_INFINITY, wall: Number.POSITIVE_INFINITY },
    ask: { large: Number.POSITIVE_INFINITY, wall: Number.POSITIVE_INFINITY },
  };
}