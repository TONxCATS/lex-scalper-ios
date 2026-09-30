# LEX QNT Scalper

A mobile-first, read-only terminal for monitoring public QNT/USDT spot market depth, spread, imbalance, and price.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/lex-qnt-scalper/src/App.tsx` — order-book terminal UI
- `artifacts/lex-qnt-scalper/src/hooks/use-market-stream.ts` — public Gate.io spot feed and live book state
- `artifacts/lex-qnt-scalper/src/index.css` — terminal theme and responsive layout

## Architecture decisions

- Market data comes from Gate.io public spot WebSocket/REST endpoints; no authenticated account, API key, or app backend is used.
- Use Gate.io because Binance and Bybit market-data endpoints were geo-restricted in this environment, while OKX did not list QNT/USDT spot.
- The book uses public top-20 snapshots and derives cumulative size, spread, imbalance, and relative liquidity flags in the browser.

## Product

- Monitors QNT/USDT top-20 bids and asks, last price, spread, 24-hour ticker context, depth imbalance, and unusually large visible orders.
- Provides connection freshness, reconnect, pause, and resume controls. It does not place trades or manage assets.

## User preferences

- Keep this iPhone-first, dark, professional, and focused on QNT/USDT public market data only.
- Do not add API-key, wallet, deposit, or real-trading flows.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
