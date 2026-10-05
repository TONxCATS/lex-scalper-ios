import { useCallback, useEffect, useRef, useState } from 'react';

export type BookLevel = {
  price: number;
  size: number;
  cumulativeSize: number;
};

export type BookState = {
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  updatedAt: number | null;
};

export type BookUpdateSource = 'snapshot' | 'stream';

export type MarketTrade = {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
};

export type BookHistoryCallbacks = {
  onBookUpdate: (
    book: BookState,
    source: BookUpdateSource,
    receivedAt: number,
  ) => void;

  onTrade: (
    trade: MarketTrade,
    receivedAt: number,
  ) => void;

  onReset: () => void;
};

export type TickerState = {
  lastPrice: number | null;
  priceChangePercent: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  quoteVolume: number | null;
};

export type ConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'disconnected';

const EMPTY_BOOK: BookState = {
  bids: [],
  asks: [],
  bestBid: null,
  bestAsk: null,
  updatedAt: null,
};

const EMPTY_TICKER: TickerState = {
  lastPrice: null,
  priceChangePercent: null,
  highPrice: null,
  lowPrice: null,
  quoteVolume: null,
};

const STREAM_URL = 'wss://api.gateio.ws/ws/v4/';

const REST_BASE = 'https://api.gateio.ws/api/v4';

function normalizePair(pair: string) {
  return pair
    .trim()
    .toUpperCase()
    .replace('/', '_')
    .replace('-', '_');
}

function asNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function levelsFrom(
  payload: unknown,
  descending: boolean,
): BookLevel[] {
  if (!Array.isArray(payload)) return [];

  const parsed = payload
    .map((entry) => {
      if (!Array.isArray(entry)) return null;

      const price = asNumber(entry[0]);
      const size = asNumber(entry[1]);

      if (
        price === null ||
        size === null ||
        price <= 0 ||
        size <= 0
      ) {
        return null;
      }

      return {
        price,
        size,
      };
    })
    .filter(
      (
        level,
      ): level is {
        price: number;
        size: number;
      } => level !== null,
    )
    .sort((a, b) =>
      descending
        ? b.price - a.price
        : a.price - b.price,
    );

  let cumulativeSize = 0;

  return parsed.map((level) => {
    cumulativeSize += level.size;

    return {
      ...level,
      cumulativeSize,
    };
  });
}

export function useMarketStream(
  currencyPair: string,
  enabled: boolean,
  beforeBookUpdate?: () => void,
  historyCallbacks?: BookHistoryCallbacks,
) {
  const pair = normalizePair(currencyPair);

  const [book, setBook] =
    useState<BookState>(EMPTY_BOOK);

  const [ticker, setTicker] =
    useState<TickerState>(EMPTY_TICKER);

  const [connection, setConnection] =
    useState<ConnectionState>('connecting');

  const [lastUpdateAt, setLastUpdateAt] =
    useState<number | null>(null);

  const [retryAttempt, setRetryAttempt] =
    useState(0);

  const [connectionNonce, setConnectionNonce] =
    useState(0);

  const retryCount = useRef(0);

  const reconnectNow = useCallback(() => {
    retryCount.current = 0;
    setRetryAttempt(0);

    setConnectionNonce(
      (value) => value + 1,
    );
  }, []);

  useEffect(() => {
    if (!enabled || !pair) {
      historyCallbacks?.onReset();

      setBook(EMPTY_BOOK);
      setTicker(EMPTY_TICKER);
      setLastUpdateAt(null);

      setConnection('disconnected');

      retryCount.current = 0;
      setRetryAttempt(0);

      return;
    }

    /*
     * IMPORTANT:
     * Whenever the market changes we immediately
     * clear data from the previous market.
     */

    setBook(EMPTY_BOOK);
    setTicker(EMPTY_TICKER);
    setLastUpdateAt(null);

    historyCallbacks?.onReset();

    retryCount.current = 0;
    setRetryAttempt(0);

    let disposed = false;

    let activeSocket: WebSocket | null = null;

    let retryTimer: number | null = null;

    let streamBookReceived = false;
    let streamTickerReceived = false;

    const snapshotAbort =
      new AbortController();

    /*
     * REST SNAPSHOT
     */

    const snapshotUrl =
      `${REST_BASE}/spot/order_book` +
      `?currency_pair=${encodeURIComponent(pair)}` +
      `&limit=100` +
      `&with_id=true`;

    fetch(snapshotUrl, {
      signal: snapshotAbort.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Snapshot failed (${response.status})`,
          );
        }

        return response.json() as Promise<
          Record<string, unknown>
        >;
      })
      .then((snapshot) => {
        if (
          disposed ||
          streamBookReceived
        ) {
          return;
        }

        const bids = levelsFrom(
          snapshot.bids,
          true,
        );

        const asks = levelsFrom(
          snapshot.asks,
          false,
        );

        if (!bids.length && !asks.length) {
          return;
        }

        const updatedAt = Date.now();

        const nextBook: BookState = {
          bids,
          asks,

          bestBid:
            bids[0]?.price ?? null,

          bestAsk:
            asks[0]?.price ?? null,

          updatedAt,
        };

        beforeBookUpdate?.();

        historyCallbacks?.onBookUpdate(
          nextBook,
          'snapshot',
          updatedAt,
        );

        setBook(nextBook);

        setLastUpdateAt(updatedAt);
      })
      .catch((error) => {
        if (
          !snapshotAbort.signal.aborted
        ) {
          console.warn(
            `Gate snapshot unavailable for ${pair}`,
            error,
          );
        }
      });

    /*
     * TICKER SNAPSHOT
     */

    const tickerUrl =
      `${REST_BASE}/spot/tickers` +
      `?currency_pair=${encodeURIComponent(pair)}`;

    fetch(tickerUrl, {
      signal: snapshotAbort.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Ticker failed (${response.status})`,
          );
        }

        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (
          disposed ||
          streamTickerReceived ||
          !Array.isArray(payload)
        ) {
          return;
        }

        const tickerRow = (
          payload as Record<
            string,
            unknown
          >[]
        ).find(
          (row) =>
            row.currency_pair === pair,
        );

        if (!tickerRow) return;

        const lastPrice =
          asNumber(tickerRow.last);

        if (lastPrice === null) {
          return;
        }

        setTicker({
          lastPrice,

          priceChangePercent:
            asNumber(
              tickerRow.change_percentage,
            ),

          highPrice:
            asNumber(
              tickerRow.high_24h,
            ),

          lowPrice:
            asNumber(
              tickerRow.low_24h,
            ),

          quoteVolume:
            asNumber(
              tickerRow.quote_volume,
            ),
        });
      })
      .catch((error) => {
        if (
          !snapshotAbort.signal.aborted
        ) {
          console.warn(
            `Gate ticker unavailable for ${pair}`,
            error,
          );
        }
      });

    /*
     * WEBSOCKET
     */

    function connect() {
      if (disposed) return;

      setConnection(
        retryCount.current === 0
          ? 'connecting'
          : 'reconnecting',
      );

      let currentSocket: WebSocket;

      try {
        currentSocket =
          new WebSocket(STREAM_URL);

        activeSocket =
          currentSocket;
      } catch {
        scheduleReconnect();
        return;
      }

      let watchdogTimer:
        number | null = null;

      let heartbeatTimer:
        number | null = null;

      const clearSocketTimers = () => {
        if (
          watchdogTimer !== null
        ) {
          window.clearTimeout(
            watchdogTimer,
          );

          watchdogTimer = null;
        }

        if (
          heartbeatTimer !== null
        ) {
          window.clearInterval(
            heartbeatTimer,
          );

          heartbeatTimer = null;
        }
      };

      const armWatchdog = () => {
        if (
          watchdogTimer !== null
        ) {
          window.clearTimeout(
            watchdogTimer,
          );
        }

        watchdogTimer =
          window.setTimeout(() => {
            currentSocket.close();
          }, 45_000);
      };

      currentSocket.onopen = () => {
        if (
          disposed ||
          activeSocket !== currentSocket
        ) {
          return;
        }

        historyCallbacks?.onReset();

        armWatchdog();

        /*
         * Heartbeat
         */

        heartbeatTimer =
          window.setInterval(() => {
            if (
              currentSocket.readyState ===
              WebSocket.OPEN
            ) {
              currentSocket.send(
                JSON.stringify({
                  time: Math.floor(
                    Date.now() / 1000,
                  ),

                  channel:
                    'spot.ping',
                }),
              );
            }
          }, 25_000);

        const time =
          Math.floor(
            Date.now() / 1000,
          );

        /*
         * ORDER BOOK
         */

        currentSocket.send(
          JSON.stringify({
            time,

            channel:
              'spot.order_book',

            event:
              'subscribe',

            payload: [
              pair,
              '100',
              '100ms',
            ],
          }),
        );

        /*
         * TICKER
         */

        currentSocket.send(
          JSON.stringify({
            time,

            channel:
              'spot.tickers',

            event:
              'subscribe',

            payload: [pair],
          }),
        );

        /*
         * PUBLIC TRADES
         */

        currentSocket.send(
          JSON.stringify({
            time,

            channel:
              'spot.trades',

            event:
              'subscribe',

            payload: [pair],
          }),
        );
      };

      currentSocket.onmessage =
        (event) => {
          if (
            disposed ||
            activeSocket !== currentSocket
          ) {
            return;
          }

          try {
            const envelope =
              JSON.parse(
                String(event.data),
              ) as {
                channel?: string;

                event?: string;

                result?:
                  | Record<
                      string,
                      unknown
                    >
                  | Array<
                      Record<
                        string,
                        unknown
                      >
                    >;
              };

            /*
             * PONG
             */

            if (
              envelope.channel ===
              'spot.pong'
            ) {
              armWatchdog();
              return;
            }

            /*
             * ERROR
             */

            if (
              envelope.event ===
              'error'
            ) {
              console.warn(
                'Gate WebSocket error:',
                envelope,
              );

              currentSocket.close();

              return;
            }

            if (
              envelope.event !==
              'update'
            ) {
              return;
            }

            const receivedAt =
              Date.now();

            let consumed = false;

            /*
             * ORDER BOOK
             */

            if (
              envelope.channel ===
                'spot.order_book' &&
              envelope.result &&
              !Array.isArray(
                envelope.result,
              )
            ) {
              const result =
                envelope.result;

              /*
               * Prevent data from another
               * market ever entering LEX.
               */

              const resultPair =
                typeof result.s ===
                'string'
                  ? result.s
                  : typeof result.currency_pair ===
                      'string'
                    ? result.currency_pair
                    : pair;

              if (
                resultPair !== pair
              ) {
                return;
              }

              const bids =
                levelsFrom(
                  result.bids,
                  true,
                );

              const asks =
                levelsFrom(
                  result.asks,
                  false,
                );

              if (
                bids.length ||
                asks.length
              ) {
                streamBookReceived =
                  true;

                const nextBook:
                  BookState = {
                  bids,
                  asks,

                  bestBid:
                    bids[0]?.price ??
                    null,

                  bestAsk:
                    asks[0]?.price ??
                    null,

                  updatedAt:
                    receivedAt,
                };

                beforeBookUpdate?.();

                historyCallbacks?.onBookUpdate(
                  nextBook,
                  'stream',
                  receivedAt,
                );

                setBook(nextBook);

                consumed = true;
              }
            }

            /*
             * TRADES
             */

            if (
              envelope.channel ===
                'spot.trades' &&
              envelope.result
            ) {
              const tradeRows =
                Array.isArray(
                  envelope.result,
                )
                  ? envelope.result
                  : [
                      envelope.result,
                    ];

              for (
                const row of tradeRows
              ) {
                if (
                  row.currency_pair !==
                  pair
                ) {
                  continue;
                }

                if (
                  row.side !== 'buy' &&
                  row.side !== 'sell'
                ) {
                  continue;
                }

                const price =
                  asNumber(
                    row.price,
                  );

                const amount =
                  asNumber(
                    row.amount,
                  );

                if (
                  price === null ||
                  amount === null ||
                  price <= 0 ||
                  amount <= 0
                ) {
                  continue;
                }

                historyCallbacks?.onTrade(
                  {
                    id: String(
                      row.id ??
                        `${row.create_time_ms ?? receivedAt}-${price}-${amount}`,
                    ),

                    side:
                      row.side,

                    price,
                    amount,
                  },
                  receivedAt,
                );

                consumed = true;
              }
            }

            /*
             * TICKER
             */

            if (
              envelope.channel ===
                'spot.tickers' &&
              envelope.result
            ) {
              const tickerRow =
                Array.isArray(
                  envelope.result,
                )
                  ? envelope.result.find(
                      (row) =>
                        row.currency_pair ===
                        pair,
                    )
                  : envelope.result
                        .currency_pair ===
                      pair
                    ? envelope.result
                    : undefined;

              const lastPrice =
                asNumber(
                  tickerRow?.last,
                );

              if (
                lastPrice !== null
              ) {
                streamTickerReceived =
                  true;

                setTicker({
                  lastPrice,

                  priceChangePercent:
                    asNumber(
                      tickerRow?.change_percentage,
                    ),

                  highPrice:
                    asNumber(
                      tickerRow?.high_24h,
                    ),

                  lowPrice:
                    asNumber(
                      tickerRow?.low_24h,
                    ),

                  quoteVolume:
                    asNumber(
                      tickerRow?.quote_volume,
                    ),
                });

                consumed = true;
              }
            }

            /*
             * CONNECTION HEALTH
             */

            if (consumed) {
              setLastUpdateAt(
                receivedAt,
              );

              setConnection(
                'live',
              );

              retryCount.current =
                0;

              setRetryAttempt(0);

              armWatchdog();
            }
          } catch (error) {
            console.warn(
              'Malformed Gate frame:',
              error,
            );
          }
        };

      currentSocket.onerror =
        () => {
          currentSocket.close();
        };

      currentSocket.onclose =
        () => {
          clearSocketTimers();

          if (
            activeSocket ===
            currentSocket
          ) {
            activeSocket = null;
          }

          if (!disposed) {
            historyCallbacks?.onReset();

            scheduleReconnect();
          }
        };
    }

    /*
     * RECONNECT
     */

    function scheduleReconnect() {
      if (
        disposed ||
        retryTimer !== null
      ) {
        return;
      }

      setConnection(
        'reconnecting',
      );

      const attempt =
        retryCount.current;

      const delay =
        Math.min(
          1000 *
            2 **
              Math.min(
                attempt,
                5,
              ),
          30_000,
        );

      retryCount.current += 1;

      setRetryAttempt(
        retryCount.current,
      );

      retryTimer =
        window.setTimeout(() => {
          retryTimer = null;

          connect();
        }, delay);
    }

    connect();

    /*
     * CLEANUP WHEN MARKET CHANGES
     */

    return () => {
      disposed = true;

      snapshotAbort.abort();

      if (
        retryTimer !== null
      ) {
        window.clearTimeout(
          retryTimer,
        );
      }

      if (
        activeSocket &&
        activeSocket.readyState ===
          WebSocket.OPEN
      ) {
        const time =
          Math.floor(
            Date.now() / 1000,
          );

        try {
          activeSocket.send(
            JSON.stringify({
              time,

              channel:
                'spot.order_book',

              event:
                'unsubscribe',

              payload: [
                pair,
                '100',
                '100ms',
              ],
            }),
          );

          activeSocket.send(
            JSON.stringify({
              time,

              channel:
                'spot.tickers',

              event:
                'unsubscribe',

              payload: [pair],
            }),
          );

          activeSocket.send(
            JSON.stringify({
              time,

              channel:
                'spot.trades',

              event:
                'unsubscribe',

              payload: [pair],
            }),
          );
        } catch {
          // Socket is being closed anyway.
        }
      }

      activeSocket?.close();

      activeSocket = null;
    };
  }, [
    pair,
    enabled,
    connectionNonce,
    beforeBookUpdate,
    historyCallbacks,
  ]);

  return {
    pair,

    book,
    ticker,

    connection,

    lastUpdateAt,
    retryAttempt,

    reconnectNow,
  };
}