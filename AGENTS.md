# AGENTS.md · System Rules Guide for AI Agents

## Overview

This guide translates `systemrule.md` into actionable instructions for AI agents working in this project. Follow these rules strictly to maintain code quality, design consistency, and system integrity.

---

## Stack

- **Language / Runtime**: TypeScript, Node >= 22.6
- **Framework**: Next.js 16 (App Router, Turbopack), React 19
- **Key dependencies**: Convex (backend), Clerk (auth), Tailwind CSS v4, shadcn/ui
- **Package manager**: pnpm (`pnpm-lock.yaml`; common `npm run` scripts map to `package.json`)

The stack is documented in the build spec foundation (`screens/SPEC.md`); the full product source of truth lives there.

## Build approach

**Tracer Bullet** (per `screens/SPEC.md` §14): build thin end to end vertical slices, each complete through every layer, verifying with lint + build + the ticket's stated evidence.

## Commands

```bash
# Install
pnpm install

# Dev server (run `npx convex dev` in a second terminal for the database)
npm run dev

# Build
npm run build

# Test
npm run test    # node scripts/verify-state-machine.ts && node --test

# Seed
npm run seed    # node scripts/seed.ts (type-stripped, requires Node >= 22.6)
```

## Specs

Product source of truth: `screens/SPEC.md` (LocalConnect / LocalHub v1). Screen mockups and planning live in `screens/` and `screens/wayfinder/`. Landing/template design reference: `design.md`. Alignment reports: `docs/alignment/`.

## Context files

- [convex/AGENTS.md](convex/AGENTS.md) (Convex backend: schema, state machine, save policy, authz guards, seeds)

---