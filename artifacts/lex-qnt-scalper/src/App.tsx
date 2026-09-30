import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Activity, Pause, Play, RotateCw } from 'lucide-react';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import {
  type BookLevel,
  type ConnectionState,
  useMarketStream,
} from '@/hooks/use-market-stream';

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

function largeOrderThreshold(levels: BookLevel[]) {
  const values = levels.map((level) => level.size).filter((size) => size > 0).sort((a, b) => a - b);
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  const upperQuartile = values[Math.floor((values.length - 1) * 0.75)];
  const average = values.reduce((sum, size) => sum + size, 0) / values.length;
  return Math.max(median * 2.7, upperQuartile * 1.75, average * 1.8);
}

function connectionCopy(state: ConnectionState) {
  if (state === 'live') return 'LIVE';
  if (state === 'connecting') return 'CONNECTING';
  if (state === 'reconnecting') return 'RECONNECTING';
  return 'DISCONNECTED';
}

function LevelRows({
  side,
  levels,
  maxSize,
  threshold,
}: {
  side: 'bid' | 'ask';
  levels: BookLevel[];
  maxSize: number;
  threshold: number;
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
    <>
      {levels.map((level, index) => {
        const isLarge = level.size >= threshold;
        const depthWidth = maxSize > 0 ? Math.max(3, (level.size / maxSize) * 100) : 0;
        return (
          <div
            className={`level-row${isLarge ? ' large-order' : ''}`}
            key={`${side}-${level.price}`}
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
              {isLarge && <span className="large-tag">LARGE</span>}
            </span>
            <span className="cumulative" data-testid={`cumulative-${side}-${index}`}>
              {formatSize(level.cumulativeSize, 3)}
            </span>
          </div>
        );
      })}
    </>
  );
}

function BookSide({
  side,
  levels,
  maxSize,
  threshold,
}: {
  side: 'bid' | 'ask';
  levels: BookLevel[];
  maxSize: number;
  threshold: number;
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
      <LevelRows side={side} levels={levels} maxSize={maxSize} threshold={threshold} />
    </section>
  );
}

function Home() {
  const [feedEnabled, setFeedEnabled] = useState(true);
  const [visibleRowCount, setVisibleRowCount] = useState<10 | 20>(20);
  const [clock, setClock] = useState(Date.now());
  const { book, ticker, connection, lastUpdateAt, retryAttempt, reconnectNow } =
    useMarketStream(feedEnabled);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { bidTotal, askTotal, bidShare, askShare } = useMemo(() => {
    const bidTotal = book.bids.reduce((sum, level) => sum + level.size, 0);
    const askTotal = book.asks.reduce((sum, level) => sum + level.size, 0);
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
  const maxSize = Math.max(0, ...book.bids.map((level) => level.size), ...book.asks.map((level) => level.size));
  const bidLargeThreshold = largeOrderThreshold(visibleBids);
  const askLargeThreshold = largeOrderThreshold(visibleAsks);
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
                <p>QNT / USDT &nbsp;·&nbsp; FULL TOP-20 SNAPSHOT</p>
              </div>
            </div>
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

          <div className="book-grid">
            <BookSide
              side="ask"
              levels={visibleAsks}
              maxSize={maxSize}
              threshold={askLargeThreshold}
            />
            <div className="mid-market" data-testid="spread-summary">
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
            />
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