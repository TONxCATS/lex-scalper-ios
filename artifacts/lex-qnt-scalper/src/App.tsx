import {
  memo,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Activity, Pause, Play, RotateCw } from 'lucide-react';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import {
  type BookLevel,
  type ConnectionState,
  useMarketStream,
} from '@/hooks/use-market-stream';
import { useOrderBookHistory } from '@/hooks/use-order-book-history';
import type { OrderBookHistoryMetrics } from '@/lib/order-book-history';

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 100 ? 3 : value >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

function formatSize(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

function formatVolume(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatAge(milliseconds: number | null) {
  if (milliseconds === null) return '—';
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Math.max(0.1, seconds).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function connectionCopy(state: ConnectionState) {
  if (state === 'live') return 'LIVE';
  if (state === 'connecting') return 'CONNECTING';
  if (state === 'reconnecting') return 'RECONNECTING';
  return 'DISCONNECTED';
}

type PriceDirection = 'up' | 'down' | null;

type PriceLevelRowProps = {
  side: 'bid' | 'ask';
  level: BookLevel;
  index: number;
  maxSize: number;
  threshold: number;
  wallThreshold: number;
};

const PriceLevelRow = memo(
  function PriceLevelRow({
    side,
    level,
    index,
    maxSize,
    threshold,
    wallThreshold,
  }: PriceLevelRowProps) {
    const isLarge = level.size >= threshold;
    const isWall = level.size >= wallThreshold;
    const depthWidth = maxSize > 0 ? Math.max(3, (level.size / maxSize) * 100) : 0;
    return (
      <div
        className={`level-row${isLarge ? ' large-order' : ''}${isWall ? ' wall-order' : ''}`}
        style={{ '--depth-width': `${depthWidth}%` } as CSSProperties}
        data-testid={`row-${side}-${index}`}
        data-price={level.price}
        aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${formatPrice(level.price)} QNT size ${formatSize(level.size)}${isLarge ? ', unusually large liquidity' : ''}`}
        title={isLarge ? 'Unusually large visible liquidity' : undefined}
      >
        <span className="price" data-testid={`price-${side}-${index}`}>
          {formatPrice(level.price)}
        </span>
        <span className="size" data-testid={`size-${side}-${index}`}>
          {formatSize(level.size)}
          {isWall ? (
            <span className="wall-tag">WALL</span>
          ) : (
            isLarge && <span className="large-tag">LARGE</span>
          )}
        </span>
        <span className="cumulative" data-testid={`cumulative-${side}-${index}`}>
          {formatSize(level.cumulativeSize, 3)}
        </span>
      </div>
    );
  },
  (previous, next) =>
    previous.side === next.side &&
    previous.index === next.index &&
    previous.level.price === next.level.price &&
    previous.level.size === next.level.size &&
    previous.level.cumulativeSize === next.level.cumulativeSize &&
    previous.maxSize === next.maxSize &&
    previous.threshold === next.threshold &&
    previous.wallThreshold === next.wallThreshold,
);

function LevelRows({
  side,
  levels,
  maxSize,
  threshold,
  wallThreshold,
}: {
  side: 'bid' | 'ask';
  levels: BookLevel[];
  maxSize: number;
  threshold: number;
  wallThreshold: number;
}) {
  if (levels.length === 0) {
    return (
      <div className="empty-book" data-testid={`empty-${side}-book`}>
        <div className="unavailable-copy">
          <strong>Depth unavailable</strong>
          <span>Waiting for a valid Gate.io order book snapshot.</span>
        </div>
      </div>
    );
  }

  return (
    levels.map((level, index) => (
      <PriceLevelRow
        key={`${side}-${level.price}`}
        side={side}
        level={level}
        index={index}
        maxSize={maxSize}
        threshold={threshold}
        wallThreshold={wallThreshold}
      />
    ))
  );
}

function BookSide({
  side,
  levels,
  maxSize,
  threshold,
  wallThreshold,
}: {
  side: 'bid' | 'ask';
  levels: BookLevel[];
  maxSize: number;
  threshold: number;
  wallThreshold: number;
}) {
  const title = side === 'bid' ? 'BID SIDE' : 'ASK SIDE';
  return (
    <section className={`book-side ${side === 'bid' ? 'bids' : 'asks'}`} aria-label={title}>
      <div className="side-title">
        <span className={`side-title-main ${side === 'bid' ? 'bid-title' : 'ask-title'}`}>
          <span aria-hidden="true">{side === 'bid' ? '↗' : '↘'}</span>
          {title}
        </span>
        <span className="side-count" data-testid={`count-${side}-levels`}>
          {levels.length ? `${levels.length} LEVELS` : '—'}
        </span>
      </div>
      <div className="column-head" aria-hidden="true">
        <span>Price</span>
        <span>Size</span>
        <span>Cumulative size</span>
      </div>
      <LevelRows
        side={side}
        levels={levels}
        maxSize={maxSize}
        threshold={threshold}
        wallThreshold={wallThreshold}
      />
    </section>
  );
}

function HistoryMetric({
  label,
  value,
  unit,
  testId,
  className = '',
  title,
}: {
  label: string;
  value: string;
  unit?: string;
  testId: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`history-metric ${className}`} data-testid={testId} title={title}>
      <span className="history-metric-label">{label}</span>
      <strong>{value}</strong>
      {unit && <small>{unit}</small>}
    </div>
  );
}

function OrderBookHistoryPanel({
  metrics,
  now,
}: {
  metrics: OrderBookHistoryMetrics;
  now: number;
}) {
  const spoofLevel =
    metrics.spoofRisk >= 65 ? 'high' : metrics.spoofRisk >= 35 ? 'medium' : 'low';
  const buyPressure = metrics.buyPressure;
  const pressureValue =
    buyPressure === null
      ? '—'
      : `${Math.round(buyPressure)} / ${Math.round(100 - buyPressure)}`;
  const sweepDetail = metrics.sweep
    ? `${metrics.sweep.levels} LEVELS · ${formatAge(now - metrics.sweep.at)}`
    : 'NO RECENT SWEEP';
  const wallText = (side: 'BID' | 'ASK', wall: OrderBookHistoryMetrics['bidWall']) =>
    wall
      ? `${side} ${formatPrice(wall.price)} · ${formatSize(wall.size, 2)} QNT · ${formatAge(wall.persistenceMs)}`
      : `${side} —`;

  return (
    <section className="history-panel" aria-label="Order book history analysis" data-testid="history-engine-panel">
      <div className="history-panel-heading">
        <span>Order book history</span>
        <span className={`history-status${metrics.baselineReady ? ' ready' : ''}`}>
          {metrics.baselineReady ? 'LIVE · 5S FLOW' : 'SAMPLING'}
        </span>
      </div>

      <div className="history-obi-grid" aria-label="Order book imbalance by distance from mid-price">
        {Object.entries(metrics.obi).map(([band, value]) => {
          const key = band.replace('.', '-').replace('%', '');
          const direction = value === null ? '' : value >= 0 ? 'positive' : 'negative';
          return (
            <div className="history-obi-cell" data-testid={`history-obi-${key}`} key={band}>
              <span>OBI {band}</span>
              <strong className={direction}>
                {value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(0)}%`}
              </strong>
            </div>
          );
        })}
      </div>

      <div className="history-metric-grid">
        <HistoryMetric
          label="MICROPRICE"
          value={formatPrice(metrics.microprice)}
          unit="USDT"
          testId="history-microprice"
        />
        <HistoryMetric
          label="BUY / SELL"
          value={pressureValue}
          unit="%"
          testId="history-buy-pressure"
          className={buyPressure === null ? '' : buyPressure >= 50 ? 'positive' : 'negative'}
        />
        <HistoryMetric
          label="ADDED"
          value={formatSize(metrics.added, 2)}
          unit="QNT"
          testId="history-added"
        />
        <HistoryMetric
          label="PULL"
          value={formatSize(metrics.pulled, 2)}
          unit="QNT"
          testId="history-pull"
        />
        <HistoryMetric
          label="REPLENISH"
          value={formatSize(metrics.replenishment, 2)}
          unit="QNT"
          testId="history-replenishment"
        />
        <HistoryMetric
          label="ABSORPTION"
          value={formatSize(metrics.absorption, 2)}
          unit="QNT"
          testId="history-absorption"
        />
        <HistoryMetric
          label="SPOOF RISK"
          value={`${metrics.spoofRisk.toFixed(0)}%`}
          unit={spoofLevel.toUpperCase()}
          testId="history-spoof-risk"
          className={`risk-${spoofLevel}`}
          title="Heuristic based on short-lived dynamic walls removed without matching public trade volume; not proof of intent."
        />
        <HistoryMetric
          label="SWEEP"
          value={
            metrics.sweep
              ? `${metrics.sweep.side === 'buy' ? 'BUY' : 'SELL'} ${metrics.sweep.levels}L`
              : '—'
          }
          unit={metrics.sweep ? formatSize(metrics.sweep.amount, 2) : 'QNT'}
          testId="history-sweep"
          className={metrics.sweep ? `sweep-${metrics.sweep.side}` : ''}
          title={sweepDetail}
        />
      </div>

      <div className="history-context-row">
        <span className="history-context-label">WALLS · PERSISTENCE</span>
        <span className="history-wall bid" data-testid="history-bid-wall">
          {wallText('BID', metrics.bidWall)}
        </span>
        <span className="history-wall ask" data-testid="history-ask-wall">
          {wallText('ASK', metrics.askWall)}
        </span>
      </div>
      <div className="history-age-row" data-testid="history-oldest-level">
        <span>OLDEST VISIBLE LEVEL</span>
        <strong>
          {metrics.oldestLevel
            ? `${metrics.oldestLevel.side.toUpperCase()} ${formatPrice(metrics.oldestLevel.price)} · ${formatAge(metrics.oldestLevel.ageMs)}`
            : '—'}
        </strong>
      </div>
      <p className="history-method-note" title="Depth deltas are estimated from consecutive Gate.io top-100 snapshots and correlated with the public taker trade stream.">
        TOP-100 SNAPSHOTS + PUBLIC TRADE TAPE · HEURISTIC SIGNALS
      </p>
    </section>
  );
}

function Home() {
  const [feedEnabled, setFeedEnabled] = useState(true);
  const [visibleRowCount, setVisibleRowCount] = useState<10 | 20>(20);
  const [followPrice, setFollowPrice] = useState(false);
  const [priceDirection, setPriceDirection] = useState<PriceDirection>(null);
  const [clock, setClock] = useState(Date.now());
  const bookScrollRef = useRef<HTMLDivElement>(null);
  const currentPriceRef = useRef<HTMLDivElement>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const { metrics: historyMetrics, callbacks: historyCallbacks } = useOrderBookHistory();
  const captureScrollBeforeBookUpdate = useCallback(() => {
    const viewport = bookScrollRef.current;
    pendingScrollTopRef.current = viewport ? viewport.scrollTop : null;
  }, []);
  const { book, ticker, connection, lastUpdateAt, retryAttempt, reconnectNow } =
    useMarketStream(feedEnabled, captureScrollBeforeBookUpdate, historyCallbacks);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const updatePriceDirection = useCallback(() => {
    const viewport = bookScrollRef.current;
    const priceAnchor = currentPriceRef.current;
    if (!viewport || !priceAnchor || ticker.lastPrice === null) {
      setPriceDirection((previous) => (previous === null ? previous : null));
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const priceRect = priceAnchor.getBoundingClientRect();
    const nextDirection: PriceDirection =
      priceRect.bottom < viewportRect.top
        ? 'up'
        : priceRect.top > viewportRect.bottom
          ? 'down'
          : null;
    setPriceDirection((previous) =>
      previous === nextDirection ? previous : nextDirection,
    );
  }, [ticker.lastPrice]);

  const scrollToCurrentPrice = useCallback(() => {
    const viewport = bookScrollRef.current;
    const priceAnchor = currentPriceRef.current;
    if (!viewport || !priceAnchor) return;

    const viewportRect = viewport.getBoundingClientRect();
    const priceRect = priceAnchor.getBoundingClientRect();
    const targetTop =
      viewport.scrollTop +
      priceRect.top -
      viewportRect.top +
      priceRect.height / 2 -
      viewport.clientHeight / 2;
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.min(maxScrollTop, Math.max(0, targetTop));
    pendingScrollTopRef.current = null;
    updatePriceDirection();
  }, [updatePriceDirection]);

  const handleBookScroll = useCallback(
    (_event: UIEvent<HTMLDivElement>) => updatePriceDirection(),
    [updatePriceDirection],
  );

  useLayoutEffect(() => {
    const viewport = bookScrollRef.current;
    if (viewport) {
      if (followPrice) {
        scrollToCurrentPrice();
      } else if (pendingScrollTopRef.current !== null) {
        const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        const preservedScrollTop = Math.min(
          maxScrollTop,
          Math.max(0, pendingScrollTopRef.current),
        );
        if (viewport.scrollTop !== preservedScrollTop) {
          viewport.scrollTop = preservedScrollTop;
        }
      }
    }
    pendingScrollTopRef.current = null;
    updatePriceDirection();
  }, [
    book.updatedAt,
    followPrice,
    scrollToCurrentPrice,
    ticker.lastPrice,
    updatePriceDirection,
    visibleRowCount,
  ]);

  const { bidTotal, askTotal, bidShare, askShare } = useMemo(() => {
    const bidTotal = book.bids
      .slice(0, 20)
      .reduce((sum, level) => sum + level.size, 0);
    const askTotal = book.asks
      .slice(0, 20)
      .reduce((sum, level) => sum + level.size, 0);
    const combined = bidTotal + askTotal;
    const bidShare = combined > 0 ? (bidTotal / combined) * 100 : null;
    return {
      bidTotal,
      askTotal,
      bidShare,
      askShare: bidShare === null ? null : 100 - bidShare,
    };
  }, [book.bids, book.asks]);

  const spread = book.bestBid !== null && book.bestAsk !== null ? book.bestAsk - book.bestBid : null;
  const midpoint =
    book.bestBid !== null && book.bestAsk !== null ? (book.bestBid + book.bestAsk) / 2 : null;
  const spreadPercent = spread !== null && midpoint ? (spread / midpoint) * 100 : null;
  const spreadBps = spread !== null && midpoint ? (spread / midpoint) * 10_000 : null;
  const visibleBids = book.bids.slice(0, visibleRowCount);
  const visibleAsks = book.asks.slice(0, visibleRowCount);
  const maxSize = Math.max(
    0,
    ...visibleBids.map((level) => level.size),
    ...visibleAsks.map((level) => level.size),
  );
  const bidLargeThreshold = historyMetrics.largeThresholds.bid;
  const askLargeThreshold = historyMetrics.largeThresholds.ask;
  const bidWallThreshold = historyMetrics.wallThresholds.bid;
  const askWallThreshold = historyMetrics.wallThresholds.ask;
  const ageSeconds = lastUpdateAt === null ? null : Math.max(0, Math.floor((clock - lastUpdateAt) / 1000));
  const freshness = ageSeconds === null ? 'WAITING FOR FIRST UPDATE' : `UPDATED ${ageSeconds}s AGO`;
  const freshnessClass = ageSeconds === null ? '' : ageSeconds <= 2 ? 'fresh' : ageSeconds <= 10 ? 'stale' : '';
  const priceChange = ticker.priceChangePercent;

  return (
    <main className="terminal-shell">
      <div className="terminal-wrap">
        <header className="topbar">
          <div className="brand-lockup" data-testid="brand-lex-qnt">
            <div className="brand-mark" aria-hidden="true"><span>LQ</span></div>
            <div>
              <div className="brand-title">LEX QNT</div>
              <div className="brand-subtitle">SCALP TERMINAL / 01</div>
            </div>
          </div>
          <div className="topbar-right">
            <span className="source-label" data-testid="data-source">
              <span className="source-dot" />
              Gate.io public market data
            </span>
            <div
              className={`connection-pill ${connection}`}
              role="status"
              aria-live="polite"
              data-testid="connection-status"
            >
              <span className="connection-indicator" />
              <span className="connection-label">{connectionCopy(connection)}</span>
            </div>
          </div>
        </header>

        <section className="instrument" aria-label="QNT USDT instrument">
          <div>
            <div className="instrument-overline">Spot / order book</div>
            <div className="pair-title">
              <h1 data-testid="instrument-symbol">QNT</h1>
              <span>/ USDT</span>
            </div>
            <div className="pair-meta">
              <span>GATE.IO</span>
              <span className="meta-divider" />
              <span>SPOT</span>
              <span className="meta-divider" />
              <span>TOP 20</span>
            </div>
          </div>
          <div className="price-block">
            <div className="last-price" data-testid="last-price">
              {formatPrice(ticker.lastPrice)}
            </div>
            <div
              className={`last-caption${priceChange !== null ? (priceChange >= 0 ? ' change-positive' : ' change-negative') : ''}`}
              data-testid="ticker-change"
            >
              {priceChange === null ? 'LAST PRICE / USDT' : `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% / 24H`}
            </div>
          </div>
        </section>

        <section className="market-strip" aria-label="24 hour market statistics">
          <div className="market-metric">
            <div className="metric-label">24h high</div>
            <div className="metric-value" data-testid="high-price">{formatPrice(ticker.highPrice)}</div>
          </div>
          <div className="market-metric">
            <div className="metric-label">24h low</div>
            <div className="metric-value" data-testid="low-price">{formatPrice(ticker.lowPrice)}</div>
          </div>
          <div className="market-metric">
            <div className="metric-label">24h quote vol</div>
            <div className="metric-value" data-testid="quote-volume">
              {ticker.quoteVolume === null ? '—' : `${formatVolume(ticker.quoteVolume)} USDT`}
            </div>
          </div>
          <div className="market-metric">
            <div className="metric-label">Best spread</div>
            <div className="metric-value spread" data-testid="spread-absolute">
              {spread === null ? '—' : formatPrice(spread)}
            </div>
          </div>
        </section>

        <section className="depth-card" aria-label="Live QNT USDT order book">
          <div className="depth-heading">
            <div className="depth-heading-title">
              <span className="section-marker" />
              <div>
                <h2>Market depth</h2>
                <p>QNT / USDT &nbsp;·&nbsp; TOP-20 DISPLAY / 100-LEVEL HISTORY</p>
              </div>
            </div>
            <div className="depth-heading-controls">
              <div className="depth-controls" aria-label="Visible order book depth">
                <span className="control-label">Rows</span>
                {[10, 20].map((count) => (
                  <button
                    className={`row-toggle${visibleRowCount === count ? ' active' : ''}`}
                    type="button"
                    onClick={() => setVisibleRowCount(count as 10 | 20)}
                    aria-pressed={visibleRowCount === count}
                    data-testid={`button-depth-${count}`}
                    key={count}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <button
                className={`follow-toggle${followPrice ? ' active' : ''}`}
                type="button"
                aria-pressed={followPrice}
                onClick={() => setFollowPrice((enabled) => !enabled)}
                data-testid="button-follow-price"
              >
                <span>FOLLOW PRICE</span>
                <span className="follow-switch" aria-hidden="true">
                  <span />
                </span>
              </button>
            </div>
          </div>

          <div className="imbalance-wrap">
            <div className="imbalance-top">
              <span className="imbalance-label">Top-20 depth imbalance</span>
              <span className="imbalance-reading" data-testid="depth-imbalance">
                {bidShare === null || askShare === null
                  ? '—'
                  : `${bidShare.toFixed(1)}% BID  /  ${askShare.toFixed(1)}% ASK`}
              </span>
            </div>
            <div
              className="imbalance-bar"
              role="img"
              aria-label={bidShare === null ? 'Depth imbalance unavailable' : `Bids ${bidShare.toFixed(1)} percent, asks ${askShare?.toFixed(1)} percent`}
              data-testid="imbalance-bar"
            >
              <div className="imbalance-bid" style={{ width: `${bidShare ?? 50}%` }} />
              <div className="imbalance-ask" />
            </div>
            <div className="imbalance-legend">
              <span className="bid-text" data-testid="bid-depth-total">BID {formatSize(bidTotal, 3)} QNT</span>
              <span className="ask-text" data-testid="ask-depth-total">ASK {formatSize(askTotal, 3)} QNT</span>
            </div>
          </div>

          <OrderBookHistoryPanel metrics={historyMetrics} now={clock} />

          <div className="book-scroll-frame">
            {priceDirection && ticker.lastPrice !== null && (
              <div
                className={`price-direction-indicator ${priceDirection}`}
                aria-label={`Current price ${priceDirection === 'up' ? 'above' : 'below'} the viewed order-book levels`}
                data-testid="current-price-direction"
              >
                <span aria-hidden="true">{priceDirection === 'up' ? '↑' : '↓'}</span>
                <span>{formatPrice(ticker.lastPrice)} USDT</span>
              </div>
            )}
            <div
              className="book-scroll-viewport"
              ref={bookScrollRef}
              onScroll={handleBookScroll}
              data-testid="book-scroll-viewport"
              tabIndex={0}
              aria-label="Scrollable live order book"
            >
              <div className="book-grid">
                <BookSide
                  side="ask"
                  levels={visibleAsks}
                  maxSize={maxSize}
                  threshold={askLargeThreshold}
                  wallThreshold={askWallThreshold}
                />
                <div
                  className="mid-market"
                  ref={currentPriceRef}
                  data-testid="spread-summary"
                >
                  <div>
                    <div className="mid-label">Last traded price</div>
                    <div className="mid-price" data-testid="mid-market-price">
                      {formatPrice(ticker.lastPrice)}
                      <small>USDT</small>
                    </div>
                  </div>
                  <div className="spread-inline" data-testid="spread-detail">
                    {spread === null ? '—' : `${formatPrice(spread)} USDT`}
                    <small>
                      {spreadPercent === null || spreadBps === null
                        ? 'SPREAD / —'
                        : `${spreadPercent.toFixed(3)}%  ·  ${spreadBps.toFixed(1)} BPS`}
                    </small>
                  </div>
                </div>
                <BookSide
                  side="bid"
                  levels={visibleBids}
                  maxSize={maxSize}
                  threshold={bidLargeThreshold}
                  wallThreshold={bidWallThreshold}
                />
              </div>
            </div>
            <button
              className="current-price-button"
              type="button"
              onClick={scrollToCurrentPrice}
              data-testid="button-current-price"
              aria-label="Scroll order book to current price"
            >
              CURRENT PRICE
            </button>
          </div>
        </section>

        <div className="footer-row">
          <div className="freshness" data-testid="last-update">
            <span className={`freshness-mark ${freshnessClass}`} />
            <span>{connection !== 'live' && book.updatedAt ? `LAST DATA · ${freshness}` : freshness}</span>
          </div>
          <div className="depth-controls">
            {feedEnabled && (
              <button
                className="feed-control"
                type="button"
                onClick={reconnectNow}
                data-testid="button-reconnect"
                aria-label="Reconnect Gate.io market data stream"
              >
                <RotateCw size={10} strokeWidth={1.8} aria-hidden="true" /> Reconnect
              </button>
            )}
            <button
              className="feed-control"
              type="button"
              onClick={() => setFeedEnabled((enabled) => !enabled)}
              data-testid={feedEnabled ? 'button-pause-feed' : 'button-resume-feed'}
              aria-label={feedEnabled ? 'Pause market data stream' : 'Resume market data stream'}
            >
              {feedEnabled ? (
                <><Pause size={10} strokeWidth={1.8} aria-hidden="true" /> Pause feed</>
              ) : (
                <><Play size={10} strokeWidth={1.8} aria-hidden="true" /> Resume feed</>
              )}
            </button>
          </div>
        </div>
        {connection === 'reconnecting' && retryAttempt > 0 && (
          <div className="retry-note" data-testid="retry-status">
            Retrying Gate.io stream · attempt {retryAttempt} · exponential backoff
          </div>
        )}
        <p className="micro-note">
          <Activity size={10} strokeWidth={1.6} aria-hidden="true" /> Public Gate.io spot feed · read-only · liquidity flags are relative to current visible depth.
        </p>
      </div>
    </main>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </WouterRouter>
  );
}

export default App;