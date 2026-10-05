import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type GateMarket = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  displaySymbol: string;
  tradeStatus: string;
};

type GateCurrencyPair = {
  id?: string;
  base?: string;
  quote?: string;
  trade_status?: string;
};

const GATE_PAIRS_URL =
  'https://api.gateio.ws/api/v4/spot/currency_pairs';

const FAVORITE_QUOTES = [
  'USDT',
  'USDC',
  'BTC',
  'ETH',
  'EUR',
];

function normalize(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace('/', '_')
    .replace('-', '_');
}

function quotePriority(quote: string) {
  const index = FAVORITE_QUOTES.indexOf(quote);

  return index === -1
    ? FAVORITE_QUOTES.length
    : index;
}

function isTradeablePair(
  pair: GateCurrencyPair,
): boolean {
  if (
    !pair.id ||
    !pair.base ||
    !pair.quote
  ) {
    return false;
  }

  /*
   * Gate normally reports:
   * trade_status = "tradable"
   *
   * We only want active Spot markets.
   */

  return pair.trade_status === 'tradable';
}

function convertMarket(
  pair: GateCurrencyPair,
): GateMarket {
  return {
    symbol: pair.id!,
    baseAsset: pair.base!,
    quoteAsset: pair.quote!,
    displaySymbol:
      `${pair.base}/${pair.quote}`,
    tradeStatus:
      pair.trade_status ?? 'unknown',
  };
}

export function useGateMarkets() {
  const [markets, setMarkets] =
    useState<GateMarket[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [search, setSearch] =
    useState('');

  const [reloadNonce, setReloadNonce] =
    useState(0);

  const reload = useCallback(() => {
    setReloadNonce(
      (value) => value + 1,
    );
  }, []);

  useEffect(() => {
    const controller =
      new AbortController();

    async function loadMarkets() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          GATE_PAIRS_URL,
          {
            signal:
              controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Gate market list failed (${response.status})`,
          );
        }

        const payload =
          (await response.json()) as GateCurrencyPair[];

        const nextMarkets =
          payload
            .filter(isTradeablePair)
            .map(convertMarket)
            .sort((a, b) => {
              /*
               * Put USDT markets first.
               */

              const quoteDifference =
                quotePriority(
                  a.quoteAsset,
                ) -
                quotePriority(
                  b.quoteAsset,
                );

              if (
                quoteDifference !== 0
              ) {
                return quoteDifference;
              }

              return a.baseAsset.localeCompare(
                b.baseAsset,
              );
            });

        if (
          !controller.signal.aborted
        ) {
          setMarkets(
            nextMarkets,
          );
        }
      } catch (cause) {
        if (
          controller.signal.aborted
        ) {
          return;
        }

        console.error(
          'Failed to load Gate markets:',
          cause,
        );

        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load Gate Spot markets.',
        );
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    loadMarkets();

    return () => {
      controller.abort();
    };
  }, [reloadNonce]);

  /*
   * ALL USDT MARKETS
   */

  const usdtMarkets =
    useMemo(
      () =>
        markets.filter(
          (market) =>
            market.quoteAsset ===
            'USDT',
        ),
      [markets],
    );

  /*
   * LIVE SEARCH
   */

  const filteredMarkets =
    useMemo(() => {
      const query =
        normalize(search)
          .replaceAll('_', '');

      if (!query) {
        /*
         * Default selector:
         * show USDT markets first.
         */

        return usdtMarkets;
      }

      return markets.filter(
        (market) => {
          const symbol =
            market.symbol
              .toUpperCase()
              .replaceAll(
                '_',
                '',
              );

          const base =
            market.baseAsset
              .toUpperCase();

          const quote =
            market.quoteAsset
              .toUpperCase();

          const display =
            `${base}${quote}`;

          return (
            symbol.includes(
              query,
            ) ||
            base.includes(
              query,
            ) ||
            quote.includes(
              query,
            ) ||
            display.includes(
              query,
            )
          );
        },
      );
    }, [
      markets,
      search,
      usdtMarkets,
    ]);

  /*
   * FIND EXACT MARKET
   *
   * Examples:
   *
   * QNT_USDT
   * QNT/USDT
   * QNT-USDT
   */

  const findMarket =
    useCallback(
      (symbol: string) => {
        const normalized =
          normalize(symbol);

        return (
          markets.find(
            (market) =>
              market.symbol ===
              normalized,
          ) ?? null
        );
      },
      [markets],
    );

  /*
   * FIND DEFAULT MARKET
   */

  const defaultMarket =
    useMemo(() => {
      /*
       * Keep QNT as our current
       * development market.
       */

      const qnt =
        markets.find(
          (market) =>
            market.symbol ===
            'QNT_USDT',
        );

      if (qnt) {
        return qnt;
      }

      /*
       * Fallback if QNT were
       * temporarily unavailable.
       */

      return (
        usdtMarkets[0] ??
        markets[0] ??
        null
      );
    }, [
      markets,
      usdtMarkets,
    ]);

  return {
    /*
     * Complete Gate Spot directory.
     */

    markets,

    /*
     * Convenient USDT subset.
     */

    usdtMarkets,

    /*
     * Search results.
     */

    filteredMarkets,

    /*
     * Search input.
     */

    search,
    setSearch,

    /*
     * Network state.
     */

    loading,
    error,

    /*
     * Helpers.
     */

    reload,
    findMarket,

    /*
     * Default LEX market.
     */

    defaultMarket,

    /*
     * Useful UI counters.
     */

    marketCount:
      markets.length,

    usdtMarketCount:
      usdtMarkets.length,
  };
}