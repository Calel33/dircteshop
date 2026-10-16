#!/usr/bin/env node
/**
 * Pins the card-muted contrast invariant (owner-workspace parity contrast repair).
 *
 * `--card` is the prototype surface in each mode (light #ffffff, dark #1e293b
 * ink-surface from public-discovery.html), so muted text on card surfaces uses
 * the dedicated `--card-muted` token, and that token must clear WCAG AA
 * (>= 4.5:1) against `--card` in both modes.
 *
 * Run: node --test scripts/card-muted-contrast.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

type Oklch = [number, number, number];

function blockOf(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start !== -1, `"${selector} {" block must exist in app/globals.css`);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

function tokenOklch(block: string, name: string): Oklch {
  const match = block.match(new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`));
  assert.ok(match, `--${name} must be defined as an oklch() value`);
  const parts = match[1].trim().split(/\s+/).map(Number);
  assert.equal(parts.length, 3, `--${name} must have L, C and H components`);
  return [parts[0], parts[1], parts[2]];
}

/** Hex (#rgb or #rrggbb) -> gamma-encoded sRGB. */
function hexToSrgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  assert.equal(h.length, 6, `expected 6-digit hex, got #${h}`);
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Resolve a theme token to sRGB, accepting oklch() or hex (prototype palette). */
function tokenSrgb(block: string, name: string): [number, number, number] {
  const hexMatch = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  if (hexMatch) return hexToSrgb(hexMatch[1]);
  return toSrgb(tokenOklch(block, name));
}

/** oklch -> oklab -> linear sRGB -> gamma-encoded sRGB (CSS Color 4 matrices). */
function toSrgb([lightness, chroma, hue]: Oklch): [number, number, number] {
  const h = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const encode = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const root = blockOf(':root');
const dark = blockOf('.dark');

/**
 * Assert one foreground/background token pair clears WCAG AA in both modes.
 * Shared by the role pairs `design.md` defines (B4 task 1: card and surface
 * roles must keep checked contrast after the palette remap).
 */
function expectPairAa(foreground: string, background: string, minimum = 4.5): void {
  for (const [mode, block] of [
    ['light', root],
    ['dark', dark],
  ] as const) {
    const ratio = contrastRatio(tokenSrgb(block, foreground), tokenSrgb(block, background));
    assert.ok(
      ratio >= minimum,
      `--${foreground} vs --${background} (${mode}) = ${ratio.toFixed(2)}:1 (need >= ${minimum}:1)`
    );
  }
}

test('--card-muted clears AA on the light-mode card', () => {
  const ratio = contrastRatio(tokenSrgb(root, 'card-muted'), tokenSrgb(root, 'card'));
  assert.ok(ratio >= 4.5, `card-muted vs light card = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`);
});

test('--card-muted clears AA on the dark-mode card', () => {
  const ratio = contrastRatio(tokenSrgb(dark, 'card-muted'), tokenSrgb(dark, 'card'));
  assert.ok(ratio >= 4.5, `card-muted vs dark card = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`);
});

test('--card-muted is exposed as a Tailwind color utility', () => {
  assert.match(
    css,
    /--color-card-muted:\s*var\(--card-muted\)/,
    '@theme inline must map --color-card-muted so text-card-muted utilities compile'
  );
});

// `design.md` (B4 task 1) defines the palette roles mapped below. The surface
// role (#53617A) is dark, so it carries its own readable foreground rather
// than pairing text-primary with it.

test('--foreground clears AA on --background in both modes', () => {
  expectPairAa('foreground', 'background');
});

test('--card-foreground clears AA on --card in both modes', () => {
  expectPairAa('card-foreground', 'card');
});

test('--primary-foreground clears AA on --primary in both modes', () => {
  expectPairAa('primary-foreground', 'primary');
});

test('--surface-foreground clears AA on --surface in both modes', () => {
  expectPairAa('surface-foreground', 'surface');
});

test('--muted-foreground clears AA on --muted in both modes', () => {
  expectPairAa('muted-foreground', 'muted');
});

test('surface roles are exposed as Tailwind color utilities', () => {
  for (const name of ['surface', 'surface-foreground']) {
    assert.match(
      css,
      new RegExp(`--color-${name}:\\s*var\\(--${name}\\)`),
      `@theme inline must map --color-${name} so its utilities compile`
    );
  }
});
