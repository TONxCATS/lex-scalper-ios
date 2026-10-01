import { useCallback, useMemo, useRef, useState } from 'react';
import type { BookHistoryCallbacks } from '@/hooks/use-market-stream';
import {
  OrderBookHistoryEngine,
  type OrderBookHistoryMetrics,
} from '@/lib/order-book-history';

export function useOrderBookHistory() {
  const engineRef = useRef<OrderBookHistoryEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new OrderBookHistoryEngine();
  }

  const [metrics, setMetrics] = useState<OrderBookHistoryMetrics>(() =>
    engineRef.current!.reset(),
  );

  const onBookUpdate = useCallback<BookHistoryCallbacks['onBookUpdate']>(
    (book, source, receivedAt) => {
      setMetrics(engineRef.current!.processBook(book, source, receivedAt));
    },
    [],
  );

  const onTrade = useCallback<BookHistoryCallbacks['onTrade']>((trade, receivedAt) => {
    setMetrics(engineRef.current!.processTrade(trade, receivedAt));
  }, []);

  const onReset = useCallback(() => {
    setMetrics(engineRef.current!.reset());
  }, []);

  const callbacks = useMemo<BookHistoryCallbacks>(
    () => ({ onBookUpdate, onTrade, onReset }),
    [onBookUpdate, onReset, onTrade],
  );

  return { metrics, callbacks };
}