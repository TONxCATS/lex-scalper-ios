import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crosshair,
  Maximize2,
  Minimize2,
  Search,
  Star,
  X,
} from 'lucide-react';
import type { OrderBookHistoryMetrics } from '@/lib/order-book-history';
import './TerminalWorkspaceView.css';

export type TerminalView = 'DOM' | 'CHART' | 'SCANNER';
export type TerminalConnectionState = 'live' | 'connecting' | 'reconnecting' | 'disconnected' | 'error';
export type TerminalDepth = 20 | 50 | 100 | 200;
export type TerminalSide = 'bid' | 'ask';

export type TerminalMarket = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  gateAvailable: boolean;
  change24h?: number | null;
  quoteVolume24h?: number | null;
};

export type TerminalLadderRow = {
  side: TerminalSide;
  price: number;
  size: number;
  cumulativeSize: number;
  ageMs: number | null;
  isLarge: boolean;
  isWall: boolean;
  eventLabels: string[];
};

export type TerminalWorkspaceHandle = {
  captureScrollAnchor: () => { scrollTop: number; anchorPrice: number | null } | null;
  scrollToCurrentPrice: () => void;
};

export type TerminalWorkspaceViewProps = {
  activeView: TerminalView;
  selectedMarket: TerminalMarket | null;
  markets: TerminalMarket[];
  favoriteSymbols: string[];
  recentSymbols: string[];
  connection: TerminalConnectionState;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  stats24h: {
    changePercent: number | null;
    high: number | null;
    low: number | null;
    quoteVolume: number | null;
  };
  bids: TerminalLadderRow[];
  asks: TerminalLadderRow[];
  actualBidCount: number;
  actualAskCount: number;
  requestedDepth: TerminalDepth;
  sourceMaximum: number;
  historyMetrics: OrderBookHistoryMetrics;
  followPrice: boolean;
  fullScreen: boolean;
  onViewChange: (view: TerminalView) => void;
  onSelectMarket: (market: TerminalMarket) => void;
  onToggleFavorite: (symbol: string) => void;
  onDepthChange: (depth: TerminalDepth) => void;
  onFollowPriceChange: (enabled: boolean) => void;
  onFullScreenChange: (enabled: boolean) => void;
  onNavigateToCurrentPrice: () => void;
};

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 100 ? 3 : value >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits });
}

function formatQuantity(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatAge(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 60_000) return `${Math.max(0.1, value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes}m ${Math.floor((value % 60_000) / 1000)}s`;
}

const LadderRow = memo(function LadderRow({
  level,
  maxSize,
}: {
  level: TerminalLadderRow;
  maxSize: number;
}) {
  const barWidth = maxSize > 0 ? Math.max(1, Math.min(100, (level.size / maxSize) * 100)) : 0;
  const age = formatAge(level.ageMs);
  return (
    <div
      className={`lx-ladder-row ${level.side}${level.isLarge ? ' is-large' : ''}${level.isWall ? ' is-wall' : ''}`}
      style={{ '--lx-depth': `${barWidth}%` } as CSSProperties}
      data-testid={`ladder-row-${level.side}-${level.price}`}
      data-price={level.price}
      aria-label={`${level.side} ${formatPrice(level.price)} size ${formatQuantity(level.size)}`}
    >
      <span className="lx-row-price">{formatPrice(level.price)}</span>
      <span className="lx-row-size">
        {formatQuantity(level.size)}
        {level.isWall && <b className="lx-tag wall-tag">WALL</b>}
        {!level.isWall && level.isLarge && <b className="lx-tag large-tag">LARGE</b>}
      </span>
      <span className="lx-row-cumulative">{formatQuantity(level.cumulativeSize)}</span>
      <span className="lx-row-signals">
        {age && <i className="lx-age-tag">{age}</i>}
        {level.eventLabels.map((label) => <i className="lx-event-tag" key={label}>{label}</i>)}
      </span>
    </div>
  );
}, (prev, next) =>
  prev.maxSize === next.maxSize &&
  prev.level.side === next.level.side &&
  prev.level.price === next.level.price &&
  prev.level.size === next.level.size &&
  prev.level.cumulativeSize === next.level.cumulativeSize &&
  prev.level.ageMs === next.level.ageMs &&
  prev.level.isLarge === next.level.isLarge &&
  prev.level.isWall === next.level.isWall &&
  prev.level.eventLabels.length === next.level.eventLabels.length &&
  prev.level.eventLabels.every((label, index) => label === next.level.eventLabels[index])
);

const ViewNavigation = memo(function ViewNavigation({
  activeView,
  onChange,
}: {
  activeView: TerminalView;
  onChange: (view: TerminalView) => void;
}) {
  return (
    <nav className="lx-view-nav" aria-label="Terminal views">
      {(['DOM', 'CHART', 'SCANNER'] as const).map((view) => (
        <button
          key={view}
          type="button"
          className={`lx-nav-button${activeView === view ? ' selected' : ''}`}
          aria-current={activeView === view ? 'page' : undefined}
          data-testid={`button-view-${view.toLowerCase()}`}
          onClick={() => onChange(view)}
        >
          {view === 'DOM' ? <Activity size={13} /> : view === 'CHART' ? <ArrowUpRight size={13} /> : <Crosshair size={13} />}
          {view}
        </button>
      ))}
    </nav>
  );
});

const TerminalWorkspaceView = forwardRef<TerminalWorkspaceHandle, TerminalWorkspaceViewProps>(
  function TerminalWorkspaceView(props, forwardedRef) {
    const {
      activeView, selectedMarket, markets, favoriteSymbols, recentSymbols, connection,
      lastPrice, bestBid, bestAsk, spread, stats24h, bids, asks, actualBidCount,
      actualAskCount, requestedDepth, sourceMaximum, followPrice, fullScreen,
      onViewChange, onSelectMarket, onToggleFavorite, onDepthChange,
      onFollowPriceChange, onFullScreenChange, onNavigateToCurrentPrice,
    } = props;
    const scrollRef = useRef<HTMLDivElement>(null);
    const currentPriceRef = useRef<HTMLDivElement>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [showReturn, setShowReturn] = useState(false);

    const captureScrollAnchor = useCallback(() => {
      const viewport = scrollRef.current;
      if (!viewport) return null;
      const visible = viewport.querySelector<HTMLElement>('[data-price]');
      return { scrollTop: viewport.scrollTop, anchorPrice: visible ? Number(visible.dataset.price) : null };
    }, []);
    const scrollToCurrentPrice = useCallback(() => {
      const viewport = scrollRef.current;
      const marker = currentPriceRef.current;
      if (!viewport || !marker) return;
      const frame = viewport.getBoundingClientRect();
      const rect = marker.getBoundingClientRect();
      const target = viewport.scrollTop + rect.top - frame.top + rect.height / 2 - viewport.clientHeight / 2;
      viewport.scrollTo({ top: Math.max(0, Math.min(target, viewport.scrollHeight - viewport.clientHeight)), behavior: 'smooth' });
      onNavigateToCurrentPrice();
      setShowReturn(false);
    }, [onNavigateToCurrentPrice]);
    useImperativeHandle(forwardedRef, () => ({ captureScrollAnchor, scrollToCurrentPrice }), [captureScrollAnchor, scrollToCurrentPrice]);

    const maxSize = useMemo(() => Math.max(0, ...bids.map((row) => row.size), ...asks.map((row) => row.size)), [bids, asks]);
    const displayedAsks = useMemo(() => [...asks].reverse(), [asks]);
    const availableCount = Math.min(sourceMaximum, actualBidCount, actualAskCount);
    const filteredMarkets = useMemo(() => {
      const query = search.trim().toLowerCase();
      return markets.filter((market) => {
        if (!market.gateAvailable) return false;
        return !query || market.symbol.toLowerCase().includes(query) ||
          market.baseAsset.toLowerCase().includes(query) || market.quoteAsset.toLowerCase().includes(query);
      }).slice(0, 80);
    }, [markets, search]);
    const favoriteSet = useMemo(() => new Set(favoriteSymbols), [favoriteSymbols]);
    const bySymbol = useMemo(() => new Map(markets.map((market) => [market.symbol, market])), [markets]);
    const groups = useMemo(() => [
      { title: 'FAVORITES', items: favoriteSymbols.map((symbol) => bySymbol.get(symbol)).filter((item): item is TerminalMarket => !!item && item.gateAvailable) },
      { title: 'RECENT', items: recentSymbols.map((symbol) => bySymbol.get(symbol)).filter((item): item is TerminalMarket => !!item && item.gateAvailable) },
    ], [favoriteSymbols, recentSymbols, bySymbol]);

    const handleScroll = useCallback(() => {
      const viewport = scrollRef.current;
      const marker = currentPriceRef.current;
      if (!viewport || !marker) return;
      const viewportRect = viewport.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      setShowReturn(markerRect.bottom < viewportRect.top || markerRect.top > viewportRect.bottom);
    }, []);
    const chooseMarket = (market: TerminalMarket) => {
      onSelectMarket(market);
      setPickerOpen(false);
      setSearch('');
    };
    const statusText = connection === 'live' ? 'LIVE' : connection === 'error' ? 'DATA ERROR' : connection.toUpperCase();
    const change = stats24h.changePercent;
    const hasBook = bids.length > 0 || asks.length > 0;

    const picker = pickerOpen && (
      <div className="lx-picker-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPickerOpen(false);
      }}>
        <section className="lx-market-picker" role="dialog" aria-modal="true" aria-label="Select market" onKeyDown={(event) => {
          if (event.key === 'Escape') setPickerOpen(false);
        }}>
          <div className="lx-picker-head">
            <div><span className="lx-eyebrow">MARKET DIRECTORY</span><h2>Select a spot market</h2></div>
            <button type="button" className="lx-icon-button" onClick={() => setPickerOpen(false)} aria-label="Close market picker" data-testid="button-close-market-picker"><X size={16} /></button>
          </div>
          <label className="lx-search-box">
            <Search size={15} aria-hidden="true" />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol or asset" aria-label="Search markets" data-testid="input-market-search" />
            <kbd>ESC</kbd>
          </label>
          {!search && groups.map(({ title, items }) => items.length > 0 && (
            <div className="lx-market-group" key={title}>
              <div className="lx-group-label">{title}</div>
              {items.map((market) => (
                <MarketOption key={`${title}-${market.symbol}`} market={market} favorite={favoriteSet.has(market.symbol)} selected={selectedMarket?.symbol === market.symbol} onChoose={chooseMarket} onFavorite={onToggleFavorite} />
              ))}
            </div>
          ))}
          <div className="lx-market-group">
            <div className="lx-group-label">{search ? 'SEARCH RESULTS' : 'AVAILABLE ON GATE'}</div>
            {filteredMarkets.map((market) => (
              <MarketOption key={`all-${market.symbol}`} market={market} favorite={favoriteSet.has(market.symbol)} selected={selectedMarket?.symbol === market.symbol} onChoose={chooseMarket} onFavorite={onToggleFavorite} />
            ))}
            {filteredMarkets.length === 0 && <div className="lx-picker-empty">No matching Gate spot markets.</div>}
          </div>
        </section>
      </div>
    );

    return (
      <main className={`lx-terminal${fullScreen ? ' fullscreen' : ''}`} data-testid="terminal-workspace">
        <div className="lx-terminal-inner">
          <header className="lx-header">
            <div className="lx-brand"><div className="lx-brand-mark">LX</div><div><strong>LEX</strong><span>SCALPER / SPOT</span></div></div>
            <ViewNavigation activeView={activeView} onChange={onViewChange} />
            <div className={`lx-connection ${connection}`} role="status" aria-live="polite" data-testid="connection-state"><i />{statusText}</div>
            {fullScreen && <button className="lx-icon-button lx-close-full" type="button" onClick={() => onFullScreenChange(false)} aria-label="Exit full screen" data-testid="button-exit-fullscreen"><X size={16} /></button>}
          </header>

          {activeView === 'DOM' ? (
            <>
              <section className="lx-instrument">
                <div className="lx-instrument-title">
                  <span className="lx-eyebrow">SPOT ORDER BOOK <i /> GATE PUBLIC FEED</span>
                  <button type="button" className="lx-market-trigger" onClick={() => setPickerOpen(true)} aria-label="Choose market" data-testid="button-market-picker">
                    <span className="lx-pair-symbol">{selectedMarket?.baseAsset ?? '—'}<small> / {selectedMarket?.quoteAsset ?? '—'}</small></span>
                    <ChevronDown size={15} />
                    {selectedMarket && favoriteSet.has(selectedMarket.symbol) && <Star className="lx-selected-star" size={13} fill="currentColor" />}
                  </button>
                  <span className="lx-pair-subline">{selectedMarket?.symbol ?? 'MARKET NOT SELECTED'} <i /> READ-ONLY</span>
                </div>
                <div className="lx-last-price-block">
                  <span className="lx-eyebrow">LAST TRADE</span>
                  <strong data-testid="last-trade-price">{formatPrice(lastPrice)}</strong>
                  <span className={`lx-change${change == null ? '' : change >= 0 ? ' positive' : ' negative'}`} data-testid="change-24h">
                    {change == null ? '24H CHANGE —' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% / 24H`}
                  </span>
                </div>
              </section>
              <section className="lx-market-stats" aria-label="24 hour market statistics">
                <Metric label="BEST BID" value={formatPrice(bestBid)} tone="bid" testId="best-bid" />
                <Metric label="BEST ASK" value={formatPrice(bestAsk)} tone="ask" testId="best-ask" />
                <Metric label="SPREAD" value={formatPrice(spread)} tone="amber" testId="spread-value" />
                <Metric label="24H HIGH / LOW" value={`${formatPrice(stats24h.high)} / ${formatPrice(stats24h.low)}`} testId="high-low-24h" />
                <Metric label="QUOTE VOL" value={stats24h.quoteVolume == null ? '—' : `${formatQuantity(stats24h.quoteVolume)} USDT`} testId="quote-volume-24h" />
              </section>

              <section className="lx-book-panel" aria-label="Continuous order book price ladder">
                <div className="lx-book-toolbar">
                  <div className="lx-section-title"><span className="lx-marker" /><div><h1>Price ladder</h1><p>CONTINUOUS DEPTH · {selectedMarket?.symbol ?? '—'}</p></div></div>
                  <div className="lx-toolbar-actions">
                    <div className="lx-depth-control" role="group" aria-label="Requested market depth">
                      {[20, 50, 100, 200].map((depth) => <button key={depth} type="button" className={requestedDepth === depth ? 'active' : ''} aria-pressed={requestedDepth === depth} onClick={() => onDepthChange(depth as TerminalDepth)} data-testid={`button-depth-${depth}`}>{depth}</button>)}
                    </div>
                    <button type="button" className={`lx-follow-toggle${followPrice ? ' enabled' : ''}`} aria-pressed={followPrice} onClick={() => onFollowPriceChange(!followPrice)} data-testid="button-follow-price"><span>FOLLOW</span><i /></button>
                    <button type="button" className="lx-icon-button lx-fullscreen-button" onClick={() => onFullScreenChange(!fullScreen)} aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'} data-testid="button-fullscreen">{fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                  </div>
                </div>
                <div className="lx-depth-meta" data-testid="depth-availability">
                  <span>REQUESTED <b>{requestedDepth}</b></span><i />
                  <span>AVAILABLE <b>{availableCount}</b> / {sourceMaximum} SOURCE MAX</span>
                  <span className={`lx-depth-live ${connection}`}><i />{connection === 'live' ? 'STREAM LIVE' : statusText}</span>
                </div>
                <div className="lx-column-head" aria-hidden="true"><span>PRICE <small>USDT</small></span><span>SIZE <small>{selectedMarket?.baseAsset ?? '—'}</small></span><span>CUM. SIZE</span><span>AGE / EVENT</span></div>
                <div className="lx-ladder-viewport" ref={scrollRef} onScroll={handleScroll} tabIndex={0} aria-label="Scrollable continuous order book ladder" data-testid="ladder-viewport">
                  {!hasBook ? (
                    <div className={`lx-book-state ${connection === 'error' || connection === 'disconnected' ? 'unavailable' : 'waiting'}`} role="status">
                      <div className="lx-state-mark"><Activity size={15} /></div>
                      <strong>{connection === 'error' ? 'Market data unavailable' : connection === 'disconnected' ? 'Feed disconnected' : 'Waiting for order book'}</strong>
                      <span>{connection === 'error' ? 'No valid levels were provided by the current feed.' : connection === 'disconnected' ? 'Reconnect the market feed to see live liquidity.' : 'The ladder will populate when a valid snapshot arrives.'}</span>
                    </div>
                  ) : (
                    <div className="lx-ladder-list">
                      {displayedAsks.map((level) => <LadderRow key={`${level.side}:${level.price}`} level={level} maxSize={maxSize} />)}
                      <div className="lx-live-separator" ref={currentPriceRef} data-testid="live-price-marker">
                        <div className="lx-separator-line"><ArrowDown size={11} /><span>LIVE PRICE</span><i /></div>
                        <div className="lx-live-tape">
                          <span className="lx-tape-price">{formatPrice(lastPrice)}</span>
                          <span className="lx-tape-unit">{selectedMarket?.quoteAsset ?? '—'}</span>
                          <span className="lx-tape-side"><b>BID</b>{formatPrice(bestBid)}</span>
                          <span className="lx-tape-side ask"><b>ASK</b>{formatPrice(bestAsk)}</span>
                          <span className="lx-tape-spread">Δ {formatPrice(spread)}</span>
                        </div>
                      </div>
                      {bids.map((level) => <LadderRow key={`${level.side}:${level.price}`} level={level} maxSize={maxSize} />)}
                    </div>
                  )}
                </div>
                {showReturn && <button type="button" className="lx-return-price" onClick={scrollToCurrentPrice} data-testid="button-current-price"><Crosshair size={13} /> CURRENT PRICE <span>{formatPrice(lastPrice)}</span></button>}
                <div className="lx-book-footer">
                  <span className="lx-side-count bid"><i /> BID LEVELS <b>{actualBidCount}</b></span>
                  <span>VISIBLE LADDER <b>{Math.min(requestedDepth, sourceMaximum)}</b> / SIDE</span>
                  <span className="lx-side-count ask">ASK LEVELS <b>{actualAskCount}</b><i /></span>
                </div>
              </section>
              <div className="lx-terminal-note"><span>LEX / DOM</span><i />PUBLIC SPOT LIQUIDITY · READ ONLY<i />NO ORDERS SENT</div>
            </>
          ) : (
            <section className="lx-placeholder-shell">
              <div className="lx-placeholder-top"><span className="lx-eyebrow">{activeView === 'CHART' ? 'MARKET STRUCTURE' : 'MARKET DISCOVERY'}</span><span className="lx-placeholder-live"><i />{statusText}</span></div>
              <div className="lx-placeholder-content">
                <div className="lx-placeholder-icon">{activeView === 'CHART' ? <ArrowDownRight size={21} /> : <Crosshair size={21} />}</div>
                <span className="lx-eyebrow">{activeView} VIEW</span>
                <h1>{activeView === 'CHART' ? 'Chart workspace' : 'Market scanner'}</h1>
                <p>{activeView === 'CHART' ? 'Chart presentation is not available in this workspace yet.' : 'Scanner presentation is not available in this workspace yet.'}</p>
                <div className="lx-placeholder-market">{selectedMarket?.symbol ?? 'NO MARKET SELECTED'}<i /> LIVE MARKET DATA IS NOT REPLACED HERE</div>
                <button type="button" onClick={() => onViewChange('DOM')} data-testid="button-return-dom">RETURN TO PRICE LADDER <ArrowUpRight size={13} /></button>
              </div>
            </section>
          )}
          {picker}
        </div>
      </main>
    );
  },
);

function Metric({ label, value, tone = '', testId }: { label: string; value: string; tone?: string; testId: string }) {
  return <div className={`lx-stat ${tone}`} data-testid={testId}><span>{label}</span><strong>{value}</strong></div>;
}

function MarketOption({
  market, favorite, selected, onChoose, onFavorite,
}: {
  market: TerminalMarket;
  favorite: boolean;
  selected: boolean;
  onChoose: (market: TerminalMarket) => void;
  onFavorite: (symbol: string) => void;
}) {
  const change = market.change24h;
  return (
    <div className={`lx-market-option${selected ? ' current' : ''}`} data-testid={`market-option-${market.symbol}`}>
      <button type="button" className="lx-market-choice" onClick={() => onChoose(market)} data-testid={`button-select-market-${market.symbol}`}>
        <span className="lx-coin-mark">{market.baseAsset.slice(0, 2).toUpperCase()}</span>
        <span className="lx-option-pair"><strong>{market.baseAsset}<small> / {market.quoteAsset}</small></strong><small>{market.symbol}</small></span>
          <span className={`lx-option-data${change == null ? '' : change >= 0 ? ' positive' : ' negative'}`}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}<small>{market.quoteVolume24h == null ? 'VOL —' : `VOL ${formatQuantity(market.quoteVolume24h)}`}</small></span>
        {selected && <Check size={14} className="lx-option-check" />}
      </button>
      <button type="button" className={`lx-favorite-button${favorite ? ' favorite' : ''}`} onClick={() => onFavorite(market.symbol)} aria-label={`${favorite ? 'Remove' : 'Add'} ${market.symbol} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite} data-testid={`button-favorite-${market.symbol}`}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button>
    </div>
  );
}

export default TerminalWorkspaceView;