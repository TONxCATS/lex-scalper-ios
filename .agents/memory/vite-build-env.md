---
name: Standalone Vite build environment
description: Required environment when running the LEX QNT Scalper production build outside its managed workflow.
---

When running the artifact's production build directly from the shell, pass `PORT` and `BASE_PATH` explicitly; shell commands do not inherit the managed workflow's environment. Set `BASE_PATH` to the artifact's current registered preview path.

**Why:** The Vite config validates both values before branching into dev-server or production-build behavior, so an ordinary `pnpm build` fails even though the managed preview works.

**How to apply:** For standalone build verification, provide both variables inline and use the artifact's current preview path rather than assuming it remains mounted at `/`.