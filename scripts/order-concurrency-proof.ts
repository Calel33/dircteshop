#!/usr/bin/env node
/**
 * Issue #81 / T9 + issue #84 / T10 — order-protocol concurrency proof harness
 * (real dev deployment).
 *
 * Runs the four §7.3 races (`docs/order-commitment-protocol.md` L1740–1749)
 * plus the #84 `load100` burst against a live Convex deployment and records
 * per-call request ids, OCC fields, latency, and the final rows:
 *
 *   1. two `placeOrder` with the same `(businessId, idempotencyKey)` + same args;
 *   2. `accept` vs `decline` on one order;
 *   3. two `accept` on one order;
 *   4. `orderExpiry:expireOrder` vs `accept` on one due order;
 *   5. `load100` — 100 concurrent `placeOrder` across 10 seeded businesses
 *      (10 each, inside the 60/10-min business cap), 10 duplicate-key pairs
 *      (INV-04), distinct contact per logical submission, p50/p95 latency, OCC
 *      retries from the log stream, and the harness's own
 *      `orderMetrics:recordOrderRejection` self-reports cross-checked against
 *      `devProof:dumpProbe` counters (plan D8 / D4).
 *
 * Why this shape (research Q1/Q2/Q5/Q7):
 *
 *   - `placeOrder` pairs go through `ConvexHttpClient` (public, anonymous).
 *   - Owner transitions spawn two parallel `node node_modules/convex/bin/main.js
 *     run … --identity` children. `--identity` is CLI admin-key impersonation:
 *     it needs a logged-in developer, must never reach a browser or CI, and the
 *     deployment logs it as `identityType: "member_acting_user"`.
 *   - Convex does not expose a request id on the `ConvexHttpClient` result, so
 *     ids are correlated from the deployment log stream (started before the
 *     scenarios, stopped afterwards). Failures additionally carry the
 *     `[Request ID: …]` text the CLI prints.
 *   - The fixtures in `convex/devProof.ts` are run-scoped by `runId`; this
 *     harness never touches pilot/seed rows and always cleans up.
 *
 * Usage:
 *   node --env-file=.env.local scripts/order-concurrency-proof.ts
 *   node --env-file=.env.local scripts/order-concurrency-proof.ts --scenario load100
 *   node scripts/order-concurrency-proof.ts --scenario load100 --dry-run
 *
 * `--scenario` accepts `all` (default), `1`–`4`, or `load100`. `--dry-run`
 * parses the selection and prints the plan, then exits — no Convex calls, no
 * log capture, no seed, no evidence write, no cleanup.
 *
 * Exit codes: 0 = every scenario asserted PASS; 1 = FAIL or BLOCKED.
 * BLOCKED means the run executed correctly but cannot claim what it set out to
 * prove (scenario 1: no observable OCC conflict; load100: fewer than ten probe
 * businesses seeded), so the run proves outcome-correctness only.
 *
 * Evidence: a run that includes `load100` writes
 * `tasks/issue-84-loadtest-evidence.md`; a scenarios 1–4 run keeps
 * `tasks/issue-81-concurrency-evidence.md`.
 *
 * Read-only with respect to the repository except for that evidence markdown.
 */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ConvexHttpClient } from 'convex/browser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(import.meta.dirname, '..');
const convexCli = path.join(repoRoot, 'node_modules', 'convex', 'bin', 'main.js');
/** Scenario 1–4 runs keep updating the #81 record. */
const evidencePath81 = path.join(repoRoot, 'tasks', 'issue-81-concurrency-evidence.md');
/** Runs that include `load100` are #84 evidence (Task 11 owns the file). */
const evidencePath84 = path.join(repoRoot, 'tasks', 'issue-84-loadtest-evidence.md');
const logDumpPath = path.join(
  process.env.TEMP ?? repoRoot,
  `t9-concurrency-logs-${Date.now()}.jsonl`
);

/** `convex/devProof.ts` `PROBE_ITEM_PRICE_CENTS`. */
const PROBE_ITEM_PRICE_CENTS = 1_250;
const PROBE_CUSTOMER_NAME = 'T9 Concurrency Probe';
const PROBE_CONTACT_PHONE = '+15550199001';

// ---------------------------------------------------------------------------
// `load100` plan (issue #84, T10 / plan D8)
//
// 10 businesses × 10 calls = 100 concurrent `placeOrder`s. The business
// throttle allows 60 accepted submissions per 10 minutes
// (`orderCommitPolicy.ts` `BUSINESS_THROTTLE_10M`), so 10 per business stays
// inside the cap and one business can never host the whole burst. Contact
// windows are 3/10 min and 10/24 h (`CONTACT_THROTTLE_10M`/
// `CONTACT_THROTTLE_24H`), which is why every logical submission gets its own
// contact hash.
// ---------------------------------------------------------------------------

const LOAD_BUSINESS_COUNT = 10;
const LOAD_CALLS_PER_BUSINESS = 10;
/** Duplicate-key pairs per business; one pair = the last two calls. */
const LOAD_REPLAY_PAIRS_PER_BUSINESS = 1;
const LOAD_TOTAL_CALLS = LOAD_BUSINESS_COUNT * LOAD_CALLS_PER_BUSINESS;
const LOAD_REPLAY_PAIRS = LOAD_BUSINESS_COUNT * LOAD_REPLAY_PAIRS_PER_BUSINESS;
/** Distinct logical submissions (each pair is one key, not two). */
const LOAD_DISTINCT_SUBMISSIONS = LOAD_TOTAL_CALLS - LOAD_REPLAY_PAIRS;

/**
 * Task 5's client mapping, reproduced exactly
 * (`components/order/basket-panel.tsx` `REJECTION_CODE_BY_ORDER_ERROR`): the
 * error code the harness observes → the `REJECTION_CODES` value it reports.
 * Every other error code is deliberately absent — it has no counter.
 */
const REJECTION_CODE_BY_ERROR: Readonly<Record<string, string | undefined>> = {
  TOO_MANY_REQUESTS: 'throttle_rejected',
  ORDER_NOT_ACCEPTED: 'block_hit',
  PRICE_CHANGED: 'price_changed',
  ITEM_UNAVAILABLE: 'item_unavailable',
  ORDERING_CLOSED: 'ordering_closed',
  OUTSIDE_HOURS: 'outside_hours',
};

/** `convex/orderCommitPolicy.ts` `REJECTION_CODES`, in the same order. */
const REJECTION_CODES = [
  'throttle_rejected',
  'block_hit',
  'price_changed',
  'item_unavailable',
  'ordering_closed',
  'outside_hours',
] as const;

/** Windows: how long a single `convex` child may run before it is killed. */
const CLI_TIMEOUT_MS = 120_000;
/** How long to let the log stream deliver a record before judging a scenario inline. */
const LOG_SETTLE_MS = 2_500;
/** How far a Completion record may sit from a call's finish before it is not attributed. */
const LOG_JOIN_TOLERANCE_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CliResult = {
  functionName: string;
  args: Record<string, unknown>;
  identity: Record<string, string> | null;
  startedAtMs: number;
  finishedAtMs: number;
  code: number;
  stdout: string;
  stderr: string;
  json: unknown;
};

type LogRecord = {
  kind?: string;
  udfType?: string;
  identifier?: string;
  requestId?: string;
  executionId?: string;
  caller?: string;
  identityType?: string;
  executionTime?: number;
  executionTimestamp?: number;
  occInfo?: unknown;
  willRetry?: boolean;
  error?: string | null;
};

type CallEvidence = {
  scenarioId: number;
  phase: string;
  label: string;
  transport: 'ConvexHttpClient' | 'convex run';
  functionName: string;
  marker: string;
  startedAtMs: number;
  finishedAtMs: number;
  ok: boolean;
  result: unknown;
  errorText: string | null;
  /** `ConvexError.data.code` (or the JSON in the text), null when the call resolved. */
  errorCode: string | null;
  requestIdFromError: string | null;
  records: LogRecord[] | null;
  joinNote: string | null;
};

type ScenarioOutcome = {
  id: number;
  title: string;
  verdict: 'PASS' | 'FAIL' | 'BLOCKED';
  assertions: string[];
  failures: string[];
  notes: string[];
  blockedReason: string | null;
  calls: CallEvidence[];
  data: Record<string, unknown>;
};

type ProbeOrder = {
  _id: string;
  status: string;
  statusReason?: string;
  createdAt: number;
  statusUpdatedAt?: number;
  subtotal?: number;
  customerName?: string;
};

type ProbeDump = {
  orders: ProbeOrder[];
  orderEvents: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  orderIdempotency: Array<Record<string, unknown>>;
  orderThrottle: Array<{ key: string; windowStart: number; count: number }>;
  orderBlocks: Array<Record<string, unknown>>;
  counts: Record<string, number>;
  // Additive #84 T10 fields (`convex/devProof.ts` `dumpProbe`). Optional so a
  // stale deployment's pre-#84 dump shape still parses; the load scenario
  // asserts the counters it needs are present.
  businessIds?: string[];
  orderMetricCounters?: Array<{ businessId: string; code: string; value: number }>;
  metricCounts?: Record<string, number>;
  perBusiness?: Array<{
    businessId: string;
    name: string;
    counts: Record<string, number>;
    metricCounts: Record<string, number>;
  }>;
};

/** One seeded probe business and the contact prefix the burst completes. */
type ProbeBusiness = {
  businessId: string;
  menuItemId: string;
  name: string;
  contactPhonePrefix: string;
};

type LogCapture = {
  records: LogRecord[];
  rawLines: string[];
  nonJsonLines: number;
  stop: () => Promise<void>;
};

type RunContext = {
  runId: string;
  command: string;
  deploymentUrl: string;
  nodeVersion: string;
  branch: string;
  startedAt: Date;
  businessId: string;
  menuItemId: string;
  ownerExternalId: string;
  /** The #84 ten-business fan-out; `businessId`/`menuItemId` are its first entry. */
  businesses: ProbeBusiness[];
  client: ConvexHttpClient;
  capture: LogCapture;
  calls: CallEvidence[];
  scenarios: ScenarioOutcome[];
  finalDump: ProbeDump | null;
  cleanup: unknown;
  fatal: string | null;
};

/** A failed behavioural assertion. */
class ProofAssertionError extends Error {}

/** A proof that ran correctly but cannot claim what it set out to prove. */
class ProofBlockedError extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ProofAssertionError(message);
  }
}

function truncate(text: string, max = 220): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function cell(text: unknown, max = 120): string {
  return truncate(typeof text === 'string' ? text : JSON.stringify(text ?? null), max).replace(
    /\|/g,
    '\\|'
  );
}

/**
 * Capability tokens are credentials: the evidence markdown is published, so the
 * renderer must never emit one. Every `accessToken` value in a serialized
 * receipt or row dump becomes `<redacted>`; the key stays so the shape is
 * still visible.
 */
function redactAccessTokens(text: string): string {
  return text.replace(/("accessToken"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"<redacted>"');
}

function extractRequestId(text: string): string | null {
  const match = /\[Request ID:\s*([^\]]+)\]/.exec(text);
  return match === null ? null : match[1].trim();
}

function uniqueKeys(rows: Array<{ key: string }>): string[] {
  return [...new Set(rows.map((row) => row.key))];
}

/**
 * Nearest-rank percentile, the same definition as
 * `convex/orderMetrics.ts` `percentile` — so the harness's p50/p95 and the
 * owner-facing metric cannot disagree on what "p95" means.
 */
function percentile(sortedValues: readonly number[], q: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const clamped = Math.min(Math.max(q, 0), 1);
  const rank = Math.ceil(clamped * sortedValues.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedValues.length - 1);
  return sortedValues[index];
}

/**
 * The typed error code a failed HTTP call carried.
 *
 * `ConvexError.data` is the server's `{ code, message }` envelope; the client's
 * message text also contains it. The `data` read is authoritative, the regex is
 * the fallback for a client that wraps or stringifies the envelope.
 */
function extractErrorCode(error: unknown, text: string): string | null {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (typeof data === 'object' && data !== null) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  const match = /"code"\s*:\s*"([A-Z_]+)"/.exec(text);
  return match === null ? null : match[1];
}

// ---------------------------------------------------------------------------
// CLI (issue #84, T10 — `--scenario load100`, plus a no-network `--dry-run`)
// ---------------------------------------------------------------------------

type ScenarioChoice = 'all' | '1' | '2' | '3' | '4' | 'load100';

type CliOptions = {
  scenario: ScenarioChoice;
  dryRun: boolean;
};

type CliParseResult =
  | { ok: true; options: CliOptions }
  | { ok: false; error: string };

const SCENARIO_CHOICES: readonly ScenarioChoice[] = ['all', '1', '2', '3', '4', 'load100'];

/**
 * Parses the harness flags. Pure and network-free, which is what makes the
 * `--dry-run` wiring check possible without contacting Convex (AC-10.8).
 */
function parseCli(argv: readonly string[]): CliParseResult {
  let scenario: ScenarioChoice = 'all';
  let scenarioSeen = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    let value: string;
    if (arg === '--scenario') {
      const next = argv[index + 1];
      if (next === undefined) {
        return {
          ok: false,
          error: `--scenario needs a value — supported: ${SCENARIO_CHOICES.join(', ')}`,
        };
      }
      value = next;
      index += 1;
    } else if (arg.startsWith('--scenario=')) {
      value = arg.slice('--scenario='.length);
    } else {
      return {
        ok: false,
        error: `unknown argument "${arg}" — supported: --scenario <${SCENARIO_CHOICES.join(
          '|'
        )}>, --dry-run`,
      };
    }

    if (scenarioSeen) {
      return { ok: false, error: '--scenario was given more than once' };
    }
    scenarioSeen = true;

    if (!SCENARIO_CHOICES.includes(value as ScenarioChoice)) {
      return {
        ok: false,
        error: `unknown scenario "${value}" — supported: ${SCENARIO_CHOICES.join(', ')}`,
      };
    }
    scenario = value as ScenarioChoice;
  }

  return { ok: true, options: { scenario, dryRun } };
}

/** A run that includes `load100` writes #84 evidence; a 1–4 run keeps #81. */
function evidencePathFor(scenario: ScenarioChoice): string {
  return scenario === 'load100' || scenario === 'all' ? evidencePath84 : evidencePath81;
}

/** The invocation contract, with the selected flags appended. */
function invocationFor(scenario: ScenarioChoice): string {
  const script = path
    .relative(repoRoot, process.argv[1] ?? 'scripts/order-concurrency-proof.ts')
    .replace(/\\/g, '/');
  const scenarioFlag = scenario === 'all' ? '' : ` --scenario ${scenario}`;
  return `node --env-file=.env.local ${script}${scenarioFlag}`;
}

/**
 * Prints the resolved plan and exits before any env check, log capture, seed,
 * mutation, evidence write, or cleanup. The load test itself is never run here.
 */
function printDryRun(options: CliOptions): void {
  console.log('dry-run: no Convex calls, no log capture, no evidence file, no cleanup');
  console.log(
    `scenario selection: ${options.scenario === 'all' ? 'all (1, 2, 3, 4, load100)' : options.scenario}`
  );

  if (options.scenario === 'all' || options.scenario === 'load100') {
    console.log(
      `load100 plan: ${LOAD_BUSINESS_COUNT} businesses × ${LOAD_CALLS_PER_BUSINESS} concurrent placeOrder = ${LOAD_TOTAL_CALLS} calls`
    );
    console.log(
      `load100 plan: ${LOAD_REPLAY_PAIRS} duplicate-key pair(s) (${LOAD_REPLAY_PAIRS * 2} calls) + ${
        LOAD_TOTAL_CALLS - LOAD_REPLAY_PAIRS * 2
      } single submissions = ${LOAD_DISTINCT_SUBMISSIONS} distinct keys`
    );
    console.log(
      `load100 plan: ${LOAD_DISTINCT_SUBMISSIONS} distinct contact hashes (a replay pair shares its contact so the args hash matches; a different phone would be IDEMPOTENCY_CONFLICT, not a replay)`
    );
    console.log(
      `load100 assertions: zero duplicate orders per replay key; no unexpected error class; self-report parity per code; counter delta parity per business`
    );
    console.log(`evidence path: ${path.relative(repoRoot, evidencePathFor(options.scenario))}`);
  }

  console.log(`invoke: ${invocationFor(options.scenario)}`);
}

/** The replay pair's key for one business. */
function loadReplayKey(runId: string, businessIndex: number, pairIndex: number): string {
  return `${runId}-load-b${businessIndex + 1}-dup${pairIndex + 1}`;
}

// ---------------------------------------------------------------------------
// CLI transport
// ---------------------------------------------------------------------------

/**
 * Runs one `convex run` invocation with an args array and `shell: false`.
 *
 * The args array is load-bearing on Windows: a shell-quoted JSON argument loses
 * its double quotes in PowerShell (`{runId:…}` → a JSON5 parse error), which is
 * exactly how the first manual attempt failed.
 */
function runCli(
  functionName: string,
  args: Record<string, unknown>,
  options: { identity?: Record<string, string> } = {}
): Promise<CliResult> {
  const argv = [convexCli, 'run', functionName, JSON.stringify(args)];
  const identity = options.identity ?? null;
  if (identity !== null) {
    argv.push('--identity', JSON.stringify(identity));
  }

  const startedAtMs = Date.now();
  return new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, argv, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
      }
    }, CLI_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);
      const trimmed = stdout.trim();
      let json: unknown = null;
      if (trimmed.length > 0) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          // Kept on `stdout`; `runCliJson` reports the parse failure with context.
          json = undefined;
        }
      }
      resolvePromise({
        functionName,
        args,
        identity,
        startedAtMs,
        finishedAtMs: Date.now(),
        code: code ?? -1,
        stdout,
        stderr,
        json,
      });
    });
  });
}

/** Runs a CLI function and returns its JSON value, throwing on a non-zero exit. */
async function runCliJson(
  functionName: string,
  args: Record<string, unknown>,
  options: { identity?: Record<string, string> } = {}
): Promise<unknown> {
  const result = await runCli(functionName, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${functionName} failed (exit ${result.code}): ${truncate(
        `${result.stderr}\n${result.stdout}`,
        600
      )}`
    );
  }
  if (result.json === undefined) {
    throw new Error(`${functionName} returned non-JSON stdout: ${truncate(result.stdout, 600)}`);
  }
  return result.json;
}

function recordCliCall(
  context: RunContext,
  scenarioId: number,
  phase: string,
  label: string,
  result: CliResult
): CallEvidence {
  const combined = `${result.stderr}\n${result.stdout}`;
  const call: CallEvidence = {
    scenarioId,
    phase,
    label,
    transport: 'convex run',
    functionName: result.functionName,
    marker: markerFor(result.functionName, result.args),
    startedAtMs: result.startedAtMs,
    finishedAtMs: result.finishedAtMs,
    ok: result.code === 0,
    result: result.json === undefined ? result.stdout.trim() || null : result.json,
    errorText: result.code === 0 ? null : truncate(combined, 1_500),
    // The CLI prints `[Request ID: …]` and the envelope text, not a typed data
    // object; the classifier reads the JSON in `errorText` when it needs a code.
    errorCode:
      result.code === 0 ? null : extractErrorCode(undefined, combined),
    requestIdFromError: result.code === 0 ? null : extractRequestId(combined),
    records: null,
    joinNote: null,
  };
  context.calls.push(call);
  return call;
}

function markerFor(functionName: string, args: Record<string, unknown>): string {
  if (typeof args.idempotencyKey === 'string') {
    return `idempotencyKey=${args.idempotencyKey}`;
  }
  if (typeof args.orderId === 'string') {
    return `orderId=${args.orderId}`;
  }
  if (typeof args.runId === 'string') {
    return `runId=${args.runId}`;
  }
  return '—';
}

// ---------------------------------------------------------------------------
// HTTP transport (public placeOrder)
// ---------------------------------------------------------------------------

async function timedHttpMutation(
  context: RunContext,
  scenarioId: number,
  phase: string,
  label: string,
  functionName: string,
  args: Record<string, unknown>
): Promise<CallEvidence> {
  // `ConvexHttpClient.mutation` is typed against a generated FunctionReference;
  // the harness calls by name so it does not depend on `_generated` in scripts.
  //
  // `{ skipQueue: true }` is load-bearing. The client queues mutations per
  // instance by default (`http_client.js` `mutationQueue`), so two calls in one
  // `Promise.all` run strictly one after the other. The public option exists
  // precisely to "request multiple mutations in parallel"
  // (`http_client.d.ts` L10–15).
  const callByName = context.client.mutation as unknown as (
    name: string,
    callArgs: Record<string, unknown>,
    options?: { skipQueue?: boolean }
  ) => Promise<unknown>;

  const startedAtMs = Date.now();
  let ok = false;
  let result: unknown = null;
  let errorText: string | null = null;
  let errorCode: string | null = null;
  try {
    result = await callByName.call(context.client, functionName, args, {
      skipQueue: true,
    });
    ok = true;
  } catch (error) {
    const message = messageOf(error);
    errorCode = extractErrorCode(error, message);
    errorText = truncate(message, 1_500);
  }

  const call: CallEvidence = {
    scenarioId,
    phase,
    label,
    transport: 'ConvexHttpClient',
    functionName,
    marker: markerFor(functionName, args),
    startedAtMs,
    finishedAtMs: Date.now(),
    ok,
    result,
    errorText,
    errorCode,
    // Documented limitation: the HTTP client surfaces no request id, even on
    // error (research Q2 item 1). Correlation happens through the log stream.
    requestIdFromError: null,
    records: null,
    joinNote: null,
  };
  context.calls.push(call);
  return call;
}

// ---------------------------------------------------------------------------
// Log capture + correlation
// ---------------------------------------------------------------------------

function startLogCapture(): LogCapture {
  const records: LogRecord[] = [];
  const rawLines: string[] = [];
  let nonJsonLines = 0;
  let buffer = '';
  let stopped = false;

  const child = spawn(
    process.execPath,
    [convexCli, 'logs', '--jsonl', '--success', '--history', '0'],
    {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        rawLines.push(line);
        if (line.startsWith('{')) {
          try {
            records.push(JSON.parse(line) as LogRecord);
          } catch {
            nonJsonLines += 1;
          }
        } else {
          nonJsonLines += 1;
        }
      }
      newline = buffer.indexOf('\n');
    }
  });

  // The banner and the "Watching logs…" line are stderr noise, not evidence.
  child.stderr.on('data', () => {});

  return {
    records,
    rawLines,
    nonJsonLines,
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, 'close'), sleep(3_000)]);
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }
      try {
        writeFileSync(logDumpPath, `${rawLines.join('\n')}\n`, 'utf8');
      } catch {
        // A missing debug dump must not fail the proof.
      }
    },
  };
}

function serverMs(record: LogRecord): number {
  // `executionTimestamp` is epoch SECONDS with sub-millisecond precision.
  return (record.executionTimestamp ?? 0) * 1_000;
}

function hasConflict(record: LogRecord): boolean {
  return record.occInfo !== null && record.occInfo !== undefined
    ? true
    : record.willRetry === true;
}

/**
 * Joins calls to Completion records.
 *
 * Records are grouped by `requestId` first: a mutation that conflicts is
 * retried inside the same HTTP request, so its conflict attempt and its retry
 * share one request id. Treating them as separate candidates would attribute
 * the two halves of one call to two different calls.
 *
 * Then, two-pass assignment:
 *   1. a failed call carries `[Request ID: …]` in its CLI output, so its group
 *      is matched exactly by `requestId`;
 *   2. the remaining calls take the nearest unclaimed group with the same
 *      `identifier`, measured against the call's finish time. Server execution
 *      happens just before the client sees the response, while a child's
 *      startup dominates its start time, so finish-time proximity is the
 *      sharpest signal available. Anything beyond ±5 s is not attributed.
 */
function joinCallsToLogs(calls: CallEvidence[], records: LogRecord[]): void {
  // Idempotent: scenario 1 joins inline to decide whether to repeat, then the
  // whole run joins again once the capture has stopped.
  for (const call of calls) {
    call.records = null;
    call.joinNote = null;
  }

  type RecordGroup = {
    requestId: string | null;
    records: LogRecord[];
    identifier: string;
    lastMs: number;
  };

  const identifiers = new Set(calls.map((call) => call.functionName));
  const groups = new Map<string, RecordGroup>();
  records.forEach((record, index) => {
    const identifier = record.identifier ?? '';
    if (!identifiers.has(identifier)) {
      return;
    }
    const key = record.requestId ?? `no-request-id:${index}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        requestId: record.requestId ?? null,
        records: [record],
        identifier,
        lastMs: serverMs(record),
      });
      return;
    }
    existing.records.push(record);
    existing.lastMs = Math.max(existing.lastMs, serverMs(record));
  });

  const allGroups = [...groups.values()];
  const used = new Set<RecordGroup>();

  for (const call of calls) {
    if (call.requestIdFromError === null) {
      continue;
    }
    const match = allGroups.find(
      (group) => group.requestId === call.requestIdFromError && !used.has(group)
    );
    if (match !== undefined) {
      match.records.sort((left, right) => serverMs(left) - serverMs(right));
      call.records = match.records;
      used.add(match);
    }
  }

  for (const call of calls) {
    if (call.records !== null) {
      continue;
    }
    const candidates = allGroups.filter(
      (group) => !used.has(group) && group.identifier === call.functionName
    );
    if (candidates.length === 0) {
      call.joinNote = `No unclaimed \`${call.functionName}\` Completion record reached the capture stream.`;
      continue;
    }
    const best = candidates.reduce((left, right) =>
      Math.abs(left.lastMs - call.finishedAtMs) <=
      Math.abs(right.lastMs - call.finishedAtMs)
        ? left
        : right
    );
    const skew = Math.abs(best.lastMs - call.finishedAtMs);
    if (skew > LOG_JOIN_TOLERANCE_MS) {
      call.joinNote = `Nearest \`${call.functionName}\` record is ${Math.round(
        skew
      )} ms from the call finish — outside the ±${LOG_JOIN_TOLERANCE_MS} ms join tolerance; not attributed.`;
      continue;
    }
    best.records.sort((left, right) => serverMs(left) - serverMs(right));
    call.records = best.records;
    used.add(best);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * One dump, optionally spanning the other nine probe businesses (#84 T10).
 *
 * `extraBusinessIds` is omitted by scenarios 1–4, so their dump is the
 * single-business shape they were written against; `load100` passes all ten so
 * the counter cross-check is one read, not ten.
 */
async function dumpProbe(
  context: RunContext,
  extraBusinessIds?: readonly string[]
): Promise<ProbeDump> {
  const args: Record<string, unknown> = {
    runId: context.runId,
    businessId: context.businessId,
  };
  if (extraBusinessIds !== undefined) {
    args.businessIds = [...extraBusinessIds];
  }
  const value = (await runCliJson('devProof:dumpProbe', args)) as ProbeDump;
  return value;
}

/**
 * The D4 self-report (AC-10.5): the harness is an observer that reports its own
 * rejections, so the counters are a measurement of one observer's outcomes
 * rather than a read of zero. It is NOT a `placeOrder` path: the mutation
 * commits in its own transaction, which is the only way a rejection can be
 * counted (research §Critical finding).
 *
 * Deliberately not routed through `timedHttpMutation`: these calls are evidence
 * plumbing, not part of the 100-call latency sample.
 */
async function reportRejection(
  context: RunContext,
  businessId: string,
  code: string
): Promise<void> {
  const callByName = context.client.mutation as unknown as (
    name: string,
    callArgs: Record<string, unknown>,
    options?: { skipQueue?: boolean }
  ) => Promise<unknown>;

  await callByName.call(
    context.client,
    'orderMetrics:recordOrderRejection',
    { businessId, code },
    { skipQueue: true }
  );
}

async function createProbeOrder(context: RunContext): Promise<string> {
  const value = (await runCliJson('devProof:createProbeOrder', {
    runId: context.runId,
    businessId: context.businessId,
  })) as { orderId: string };
  return value.orderId;
}

function placeOrderArgs(
  context: RunContext,
  idempotencyKey: string
): Record<string, unknown> {
  return {
    businessId: context.businessId,
    lines: [{ menuItemId: context.menuItemId, quantity: 1 }],
    customerName: PROBE_CUSTOMER_NAME,
    contactPhone: PROBE_CONTACT_PHONE,
    expectedSubtotal: PROBE_ITEM_PRICE_CENTS,
    idempotencyKey,
  };
}

function orderById(dump: ProbeDump, orderId: string): ProbeOrder | null {
  return dump.orders.find((order) => order._id === orderId) ?? null;
}

/**
 * Opens both HTTP connections before the duplicate pair.
 *
 * Without a warm pool, the first `placeOrder` pays DNS + TLS while the second
 * reuses the pool, and the two executions reached the dev server 78–117 ms
 * apart in the first runs — enough for the loser's fast path to see the
 * committed idempotency row, so no OCC conflict could occur.
 *
 * The warm-up is not the only cause, and `skipQueue` in `timedHttpMutation` is
 * not optional: `ConvexHttpClient` serializes mutations per instance by default
 * (`http_client.js` L302–323), so without it the pair is never concurrent.
 */
async function warmHttpClient(context: RunContext): Promise<void> {
  const queryByName = context.client.query as unknown as (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  // Four parallel reads so the pool holds several idle keep-alive sockets
  // (two `placeOrder` fetches must not share one connection serially).
  await Promise.all([
    queryByName.call(context.client, 'categories:listOrdered', {}),
    queryByName.call(context.client, 'categories:listOrdered', {}),
    queryByName.call(context.client, 'categories:listOrdered', {}),
    queryByName.call(context.client, 'categories:listOrdered', {}),
  ]);
  await sleep(150);
}

function eventsFor(dump: ProbeDump, orderId: string): Array<Record<string, unknown>> {
  return dump.orderEvents.filter((event) => event.orderId === orderId);
}

// ---------------------------------------------------------------------------
// Scenario 1 — duplicate submit (§7.3 L1744)
// ---------------------------------------------------------------------------

async function placeOrderAttempt(
  context: RunContext,
  outcome: ScenarioOutcome,
  attempt: number
): Promise<{ conflictedInline: boolean }> {
  const idempotencyKey = `${context.runId}-dup-${attempt}`;
  const args = placeOrderArgs(context, idempotencyKey);
  const before = await dumpProbe(context);

  const pair = await Promise.all([
    timedHttpMutation(context, 1, `attempt-${attempt}`, 'placeOrder #1', 'orders:placeOrder', args),
    timedHttpMutation(context, 1, `attempt-${attempt}`, 'placeOrder #2', 'orders:placeOrder', args),
  ]);
  const after = await dumpProbe(context);

  assert(
    pair.every((call) => call.ok),
    `attempt ${attempt}: both placeOrder calls must resolve — got ${pair
      .map((call) => (call.ok ? 'ok' : `error: ${call.errorText}`))
      .join(' / ')}`
  );

  const orderIds = pair.map(
    (call) => (call.result as { orderId?: string } | null)?.orderId ?? null
  );
  assert(
    orderIds[0] !== null && orderIds[0] === orderIds[1],
    `attempt ${attempt}: both responses must return the same orderId — got ${JSON.stringify(
      orderIds
    )}`
  );
  const orderId = orderIds[0] as string;

  const orderDelta = after.counts.orders - before.counts.orders;
  const eventDelta = after.counts.orderEvents - before.counts.orderEvents;
  const notificationDelta = after.counts.notifications - before.counts.notifications;
  const idempotencyDelta = after.counts.orderIdempotency - before.counts.orderIdempotency;

  assert(orderDelta === 1, `attempt ${attempt}: expected exactly 1 new order, got ${orderDelta}`);
  assert(
    eventDelta === 1,
    `attempt ${attempt}: expected exactly 1 new orderEvents row, got ${eventDelta}`
  );
  assert(
    notificationDelta === 1,
    `attempt ${attempt}: expected exactly 1 new notification, got ${notificationDelta}`
  );
  assert(
    idempotencyDelta === 1,
    `attempt ${attempt}: expected exactly 1 new orderIdempotency row, got ${idempotencyDelta}`
  );

  const keysForAttempt = after.orderIdempotency.filter(
    (row) => row.key === idempotencyKey
  );
  assert(
    keysForAttempt.length === 1,
    `attempt ${attempt}: expected exactly 1 orderIdempotency row for the key, got ${keysForAttempt.length}`
  );
  assert(
    keysForAttempt[0].orderId === orderId,
    `attempt ${attempt}: idempotency row points at ${String(
      keysForAttempt[0].orderId
    )}, responses returned ${orderId}`
  );

  const newOrder = orderById(after, orderId);
  assert(newOrder !== null, `attempt ${attempt}: committed order ${orderId} not found in dump`);
  assert(
    newOrder.status === 'new',
    `attempt ${attempt}: committed order status must be "new", got "${newOrder.status}"`
  );
  assert(
    newOrder.subtotal === PROBE_ITEM_PRICE_CENTS,
    `attempt ${attempt}: expected subtotal ${PROBE_ITEM_PRICE_CENTS}, got ${String(newOrder.subtotal)}`
  );

  const orderEvents = eventsFor(after, orderId);
  assert(
    orderEvents.length === 1,
    `attempt ${attempt}: expected exactly 1 event for the order, got ${orderEvents.length}`
  );
  assert(
    orderEvents[0].action === 'submitted' && orderEvents[0].actorType === 'customer',
    `attempt ${attempt}: the single event must be the customer "submitted" event — got ${JSON.stringify(
      orderEvents[0]
    )}`
  );

  // Research Q5's visible symptom: a split counter would be two rows for one key.
  const throttleKeys = uniqueKeys(after.orderThrottle);
  assert(
    throttleKeys.length === after.orderThrottle.length,
    `attempt ${attempt}: duplicate orderThrottle rows for one key — keys ${JSON.stringify(
      throttleKeys
    )}, rows ${JSON.stringify(after.orderThrottle)}`
  );
  assert(
    after.orderThrottle.length === 3,
    `attempt ${attempt}: expected exactly 3 throttle rows (business 10m + contact 10m + contact 24h), got ${after.orderThrottle.length}: ${JSON.stringify(
      after.orderThrottle
    )}`
  );
  const businessKeys = throttleKeys.filter((key) => key === `business:${context.businessId}:10m`);
  const contactKeys = throttleKeys.filter((key) =>
    key.startsWith(`contact:${context.businessId}:`)
  );
  assert(
    businessKeys.length === 1,
    `attempt ${attempt}: expected the business 10m key, got ${JSON.stringify(throttleKeys)}`
  );
  assert(
    contactKeys.length === 2,
    `attempt ${attempt}: expected both contact windows (10m + 24h), got ${JSON.stringify(
      throttleKeys
    )}`
  );
  // The contact windows are claimed only after the post-claim replay check
  // (`orders.ts` L889–911), so a raced duplicate must never consume one:
  // exactly one slot per accepted submission, per window.
  const contactRows = after.orderThrottle.filter((row) =>
    row.key.startsWith(`contact:${context.businessId}:`)
  );
  for (const row of contactRows) {
    assert(
      row.count === attempt,
      `attempt ${attempt}: contact throttle ${row.key} must count ${attempt} accepted submission(s), got ${row.count}`
    );
  }

  // The business row is claimed BEFORE the re-check because its patch is the
  // serialization write (protocol L1044 steps 2–3; `orders.ts` L884–886). A
  // truly racing loser therefore claims one extra business slot before it sees
  // the winner's idempotency row. The protocol only promises that the *fast
  // path* does not consume a slot (L1044 step 1), so 1 or 2 per accepted
  // submission is the specified range; anything else is a defect. The observed
  // value is recorded, not smoothed over.
  const businessRow = after.orderThrottle.find(
    (row) => row.key === `business:${context.businessId}:10m`
  );
  assert(businessRow !== undefined, `attempt ${attempt}: business throttle row missing`);
  const businessCount = businessRow.count;
  assert(
    businessCount === attempt || businessCount === attempt * 2,
    `attempt ${attempt}: business throttle must count ${attempt} (fast path) or ${
      attempt * 2
    } (racing loser claimed before the re-check), got ${businessCount}`
  );

  outcome.assertions.push(
    `attempt ${attempt}: both calls resolved with the same orderId \`${orderId}\``
  );
  outcome.assertions.push(
    `attempt ${attempt}: exactly 1 order / 1 event / 1 notification / 1 idempotency row (deltas ${orderDelta}/${eventDelta}/${notificationDelta}/${idempotencyDelta})`
  );
  outcome.assertions.push(
    `attempt ${attempt}: exactly one row per throttle key, counts ${after.orderThrottle
      .map((row) => `${row.key}=${row.count}`)
      .join(', ')}`
  );
  if (businessCount === attempt * 2) {
    outcome.notes.push(
      `attempt ${attempt}: the business window counted ${businessCount} for ${attempt} accepted submission(s) — the racing loser claimed a business slot before the post-claim replay check (protocol L1044 step 2 precedes step 3, and the loser returns before the contact claims). This is the specified critical section, not an idempotency defect; the contact windows stayed at ${attempt}.`
    );
  }

  outcome.data[`attempt${attempt}`] = {
    idempotencyKey,
    orderId,
    throttle: after.orderThrottle,
    dump: after,
  };

  await sleep(LOG_SETTLE_MS);
  const inlineCalls = context.calls.filter(
    (call) => call.scenarioId === 1 && call.phase === `attempt-${attempt}`
  );
  joinCallsToLogs(inlineCalls, context.capture.records);
  return {
    conflictedInline: inlineCalls.some((call) =>
      (call.records ?? []).some((record) => hasConflict(record))
    ),
  };
}

async function scenario1(
  context: RunContext,
  outcome: ScenarioOutcome
): Promise<void> {
  const first = await placeOrderAttempt(context, outcome, 1);
  if (first.conflictedInline) {
    outcome.assertions.push('attempt 1: an OCC conflict is visible in the log stream (occInfo/willRetry)');
    outcome.notes.push(
      'attempt 1: the losing execution recorded `occInfo` with `willRetry: true`, was retried under the same `requestId`, and the retry returned the winner’s receipt from the fast path — which is why the throttle windows still counted exactly one accepted submission.'
    );
    return;
  }

  outcome.notes.push(
    'attempt 1 showed no `occInfo`/`willRetry` conflict; repeating once with a fresh idempotency key (plan Risks row 1).'
  );
  const second = await placeOrderAttempt(context, outcome, 2);
  if (second.conflictedInline) {
    outcome.assertions.push('attempt 2: an OCC conflict is visible in the log stream (occInfo/willRetry)');
    outcome.notes.push(
      'attempt 2: the losing execution recorded `occInfo` with `willRetry: true`, was retried under the same `requestId`, and the retry returned the winner’s receipt from the fast path — which is why the contact windows still counted exactly the accepted submissions.'
    );
    return;
  }

  // Not thrown here: the final verdict is recomputed after the capture stops,
  // because late records must be allowed to change the answer.
  outcome.notes.push(
    'no conflict observed in either attempt so far; the final verdict is decided after the log capture stops.'
  );
  outcome.data.noConflictInline = true;
}

// ---------------------------------------------------------------------------
// Scenario 2 — accept vs decline (§7.3 L1745)
// ---------------------------------------------------------------------------

async function scenario2(context: RunContext, outcome: ScenarioOutcome): Promise<void> {
  const orderId = await createProbeOrder(context);
  const baseArgs = { businessId: context.businessId, orderId };

  const [accept, decline] = await Promise.all([
    runCli(
      'orders:transitionOrderStatus',
      { ...baseArgs, action: 'accept' },
      { identity: { subject: context.ownerExternalId } }
    ),
    runCli(
      'orders:transitionOrderStatus',
      { ...baseArgs, action: 'decline', reason: 'T9 proof decline' },
      { identity: { subject: context.ownerExternalId } }
    ),
  ]);
  recordCliCall(context, 2, 'race', 'accept', accept);
  recordCliCall(context, 2, 'race', 'decline', decline);

  const acceptOk = accept.code === 0;
  const declineOk = decline.code === 0;
  assert(
    acceptOk !== declineOk,
    `expected exactly one winner — accept exit ${accept.code}, decline exit ${decline.code}`
  );

  const winner = acceptOk ? 'accept' : 'decline';
  const loser = acceptOk ? decline : accept;
  assert(
    `${loser.stderr}\n${loser.stdout}`.includes('ORDER_ALREADY_DECIDED'),
    `loser (${winner === 'accept' ? 'decline' : 'accept'}) must fail with ORDER_ALREADY_DECIDED — got: ${truncate(
      `${loser.stderr}\n${loser.stdout}`,
      600
    )}`
  );

  const after = await dumpProbe(context);
  const order = orderById(after, orderId);
  assert(order !== null, `probe order ${orderId} missing from the dump`);
  const expectedStatus = winner === 'accept' ? 'accepted' : 'declined';
  assert(
    order.status === expectedStatus,
    `final status must be the winner's (${expectedStatus}), got "${order.status}"`
  );

  const events = eventsFor(after, orderId);
  assert(events.length === 1, `expected exactly 1 owner event for the decision, got ${events.length}`);
  assert(
    events[0].actorType === 'owner' &&
      events[0].action === (winner === 'accept' ? 'accepted' : 'declined'),
    `the single event must be the winner's owner event — got ${JSON.stringify(events[0])}`
  );

  outcome.assertions.push(
    `exactly one winner: ${winner} (accept exit ${accept.code}, decline exit ${decline.code})`
  );
  outcome.assertions.push(`loser failed with ORDER_ALREADY_DECIDED`);
  outcome.assertions.push(`final status \`${order.status}\`; exactly 1 owner event \`${String(events[0].action)}\``);
  outcome.data = { orderId, winner, accept, decline, order, events, dump: after };
}

// ---------------------------------------------------------------------------
// Scenario 3 — accept vs accept (§7.3 L1746)
// ---------------------------------------------------------------------------

async function scenario3(context: RunContext, outcome: ScenarioOutcome): Promise<void> {
  const orderId = await createProbeOrder(context);
  const args = { businessId: context.businessId, orderId, action: 'accept' };

  const [left, right] = await Promise.all([
    runCli('orders:transitionOrderStatus', args, {
      identity: { subject: context.ownerExternalId },
    }),
    runCli('orders:transitionOrderStatus', args, {
      identity: { subject: context.ownerExternalId },
    }),
  ]);
  const leftCall = recordCliCall(context, 3, 'race', 'accept #1', left);
  const rightCall = recordCliCall(context, 3, 'race', 'accept #2', right);

  assert(
    left.code === 0 && right.code === 0,
    `both accepts must succeed — exits ${left.code}/${right.code}; stderr: ${truncate(
      `${left.stderr} ${right.stderr}`,
      600
    )}`
  );

  const leftResult = left.json as { status?: string; reused?: boolean } | null;
  const rightResult = right.json as { status?: string; reused?: boolean } | null;
  assert(
    leftResult?.status === 'accepted' && rightResult?.status === 'accepted',
    `both responses must report status "accepted" — got ${JSON.stringify([leftResult, rightResult])}`
  );

  const reusedCount = [leftResult?.reused, rightResult?.reused].filter(
    (value) => value === true
  ).length;
  const movedCount = [leftResult?.reused, rightResult?.reused].filter(
    (value) => value === false
  ).length;
  assert(
    reusedCount === 1 && movedCount === 1,
    `expected exactly one \`reused:false\` (the move) and one \`reused:true\` (the replay) — got ${JSON.stringify(
      [leftResult, rightResult]
    )}`
  );

  const after = await dumpProbe(context);
  const order = orderById(after, orderId);
  assert(order !== null, `probe order ${orderId} missing from the dump`);
  assert(
    order.status === 'accepted',
    `final status must be "accepted", got "${order.status}"`
  );

  const events = eventsFor(after, orderId);
  assert(events.length === 1, `expected exactly 1 accepted event, got ${events.length}`);
  assert(
    events[0].action === 'accepted' && events[0].actorType === 'owner',
    `the single event must be the owner "accepted" event — got ${JSON.stringify(events[0])}`
  );

  const firstToReturn =
    left.finishedAtMs <= right.finishedAtMs ? 'accept #1' : 'accept #2';
  outcome.assertions.push(
    `both accepts succeeded with status "accepted" (${reusedCount} reused, ${movedCount} moved)`
  );
  outcome.assertions.push('exactly 1 accepted event; final status `accepted`');
  outcome.assertions.push(
    `first child to return: ${firstToReturn} (${Math.abs(
      left.finishedAtMs - right.finishedAtMs
    )} ms apart)`
  );
  outcome.data = {
    orderId,
    left: leftCall.result,
    right: rightCall.result,
    firstToReturn,
    order,
    events,
    dump: after,
  };
}

// ---------------------------------------------------------------------------
// Scenario 4 — expire vs accept (§7.3 L1747)
// ---------------------------------------------------------------------------

async function scenario4(context: RunContext, outcome: ScenarioOutcome): Promise<void> {
  const orderId = await createProbeOrder(context);
  // Due row created immediately before the pair: the 5-minute cron may sweep it
  // at any moment, so the window between these two calls stays as small as the
  // CLI allows.
  await runCliJson('devProof:forceDueExpiry', { runId: context.runId, orderId });
  const firedAt = Date.now();

  const [expire, accept] = await Promise.all([
    runCli('orderExpiry:expireOrder', { orderId }),
    runCli(
      'orders:transitionOrderStatus',
      { businessId: context.businessId, orderId, action: 'accept' },
      { identity: { subject: context.ownerExternalId } }
    ),
  ]);
  recordCliCall(context, 4, 'race', 'expireOrder', expire);
  recordCliCall(context, 4, 'race', 'accept', accept);

  const after = await dumpProbe(context);
  const order = orderById(after, orderId);
  assert(order !== null, `probe order ${orderId} missing from the dump`);
  assert(
    order.status === 'expired' || order.status === 'accepted',
    `final status must be "expired" or "accepted", got "${order.status}"`
  );

  const events = eventsFor(after, orderId);
  const expiredEvents = events.filter((event) => event.action === 'expired');
  const acceptedEvents = events.filter((event) => event.action === 'accepted');

  assert(
    !(order.status === 'accepted' && expiredEvents.length > 0),
    'forbidden state: accepted AND an expired event exists'
  );
  assert(
    !(order.status === 'expired' && acceptedEvents.length > 0),
    'forbidden state: expired AND an accepted event exists'
  );
  assert(
    events.length === 1,
    `expected exactly 1 terminal event, got ${events.length}: ${JSON.stringify(events)}`
  );

  if (order.status === 'expired') {
    assert(
      expiredEvents.length === 1 && acceptedEvents.length === 0,
      `expired outcome must have exactly 1 expired event and 0 accepted events — got ${JSON.stringify(
        events
      )}`
    );
    assert(
      expire.code === 0,
      `the winning expire call must exit 0, got ${expire.code}: ${truncate(expire.stderr, 400)}`
    );
    assert(
      accept.code !== 0,
      'the losing accept must fail when expire wins'
    );
    const acceptError = `${accept.stderr}\n${accept.stdout}`;
    assert(
      acceptError.includes('ORDER_EXPIRED') ||
        acceptError.includes('ORDER_ALREADY_DECIDED'),
      `the losing accept must fail with ORDER_EXPIRED or ORDER_ALREADY_DECIDED — got: ${truncate(
        acceptError,
        600
      )}`
    );
    outcome.assertions.push(
      'expire won: status `expired`, 1 system expired event, 0 accepted events'
    );
    outcome.assertions.push('losing accept failed with ORDER_EXPIRED/ORDER_ALREADY_DECIDED');
  } else {
    assert(
      acceptedEvents.length === 1 && expiredEvents.length === 0,
      `accepted outcome must have exactly 1 accepted event and 0 expired events — got ${JSON.stringify(
        events
      )}`
    );
    assert(
      accept.code === 0,
      `the winning accept call must exit 0, got ${accept.code}: ${truncate(accept.stderr, 400)}`
    );
    // `expireOrder` is a no-op on a non-`new` order (`orderExpiry.ts` L57–60),
    // so the losing expire call exits 0 without writing anything. The absence
    // of an expired event is the proof it did not win.
    assert(
      expire.code === 0,
      `the losing expire call must be a clean no-op, got exit ${expire.code}: ${truncate(
        expire.stderr,
        400
      )}`
    );
    outcome.assertions.push(
      'accept won: status `accepted`, 1 owner accepted event, 0 expired events'
    );
    outcome.assertions.push(
      'losing expireOrder was a clean no-op (exit 0, no status change, no event)'
    );
  }

  outcome.data = {
    orderId,
    firedAt,
    firedAtIso: iso(firedAt),
    expire,
    accept,
    order,
    events,
    dump: after,
  };
  outcome.notes.push(
    `due-expiry row created immediately before the pair; pair fired at ${iso(firedAt)} (wall clock; the cron interval is 5 minutes and its phase is not exposed).`
  );
}

// ---------------------------------------------------------------------------
// Scenario 5 — 100-way burst across 10 businesses (#84 T10 / plan D8)
// ---------------------------------------------------------------------------

type LoadCallSpec = {
  businessId: string;
  menuItemId: string;
  label: string;
  idempotencyKey: string;
  contactPhone: string;
  /** The replay key this call shares with its pair, or null for a single. */
  replayKey: string | null;
};

type LoadScenarioData = {
  businessIds: string[];
  outcomeCounts: {
    total: number;
    success: number;
    expectedRejection: number;
    unexpected: number;
  };
  observed: Record<string, number>;
  reported: Record<string, number>;
  reportFailures: string[];
  counterDeltas: Record<string, number>;
  perBusinessCounters: Array<{
    businessId: string;
    code: string;
    reported: number;
    delta: number;
  }>;
  latency: {
    sampleSize: number;
    p50: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
  };
  occ: { joined: number; callsWithConflict: number; conflictingRecords: number };
  duplicateKeys: Array<{ key: string; calls: number; orderIds: string[] }>;
  dump: ProbeDump;
};

/**
 * The 100 planned calls: 10 per business, of which the last two replay one key
 * and one contact.
 *
 * A replay pair must pass the SAME args — the args hash covers the contact — so
 * a different phone would surface as `IDEMPOTENCY_CONFLICT`, not as a replay.
 * Every other call gets its own contact hash (`contactPhonePrefix` + a 6-digit
 * ordinal), which also keeps each contact far inside the 3/10 min and 10/24 h
 * contact windows.
 */
function loadCallSpecs(context: RunContext): LoadCallSpec[] {
  const specs: LoadCallSpec[] = [];
  const firstReplaySlot = LOAD_CALLS_PER_BUSINESS - LOAD_REPLAY_PAIRS_PER_BUSINESS * 2;

  context.businesses.forEach((business, businessIndex) => {
    for (let slot = 0; slot < LOAD_CALLS_PER_BUSINESS; slot += 1) {
      const replay = slot >= firstReplaySlot;
      const pairIndex = replay
        ? Math.floor((slot - firstReplaySlot) / 2)
        : -1;
      // Both calls of a pair use the pair's first contact, so their args match.
      const contactSlot = replay ? firstReplaySlot + pairIndex * 2 : slot;
      specs.push({
        businessId: business.businessId,
        menuItemId: business.menuItemId,
        label: `b${businessIndex + 1}-c${slot + 1}`,
        idempotencyKey: replay
          ? loadReplayKey(context.runId, businessIndex, pairIndex)
          : `${context.runId}-load-b${businessIndex + 1}-c${slot + 1}`,
        contactPhone: `${business.contactPhonePrefix}${String(contactSlot).padStart(6, '0')}`,
        replayKey: replay ? loadReplayKey(context.runId, businessIndex, pairIndex) : null,
      });
    }
  });

  return specs;
}

async function scenario5(context: RunContext, outcome: ScenarioOutcome): Promise<void> {
  if (context.businesses.length !== LOAD_BUSINESS_COUNT) {
    throw new ProofBlockedError(
      `load100 needs ${LOAD_BUSINESS_COUNT} seeded probe businesses, got ${context.businesses.length} — deploy the working tree's devProof:seedProbe first`
    );
  }

  const businessIds = context.businesses.map((business) => business.businessId);
  const specs = loadCallSpecs(context);
  assert(
    specs.length === LOAD_TOTAL_CALLS,
    `expected ${LOAD_TOTAL_CALLS} planned calls, got ${specs.length}`
  );
  const distinctPhones = new Set(specs.map((spec) => spec.contactPhone));
  assert(
    distinctPhones.size === LOAD_DISTINCT_SUBMISSIONS,
    `expected ${LOAD_DISTINCT_SUBMISSIONS} distinct contact inputs, got ${distinctPhones.size}`
  );

  const before = await dumpProbe(context, businessIds);

  // One Promise.all: every mutation is in flight before any resolves.
  // `timedHttpMutation`'s `skipQueue` is what makes that true (the client
  // otherwise serializes mutations per instance).
  const calls = await Promise.all(
    specs.map((spec) =>
      timedHttpMutation(context, 5, 'burst', spec.label, 'orders:placeOrder', {
        businessId: spec.businessId,
        lines: [{ menuItemId: spec.menuItemId, quantity: 1 }],
        customerName: PROBE_CUSTOMER_NAME,
        contactPhone: spec.contactPhone,
        expectedSubtotal: PROBE_ITEM_PRICE_CENTS,
        idempotencyKey: spec.idempotencyKey,
      })
    )
  );

  // --- Classify every outcome: success / expected-rejection / unexpected ----
  const unexpected: string[] = [];
  const observed: Record<string, number> = {};
  const successes: Array<{
    spec: LoadCallSpec;
    call: CallEvidence;
    orderId: string;
  }> = [];

  calls.forEach((call, index) => {
    const spec = specs[index];
    if (call.ok) {
      const orderId = (call.result as { orderId?: string } | null)?.orderId ?? null;
      if (orderId === null) {
        unexpected.push(
          `${spec.label}: resolved without an orderId — result ${cell(call.result, 200)}`
        );
        return;
      }
      successes.push({ spec, call, orderId });
      return;
    }

    const rejection =
      call.errorCode === null ? undefined : REJECTION_CODE_BY_ERROR[call.errorCode];
    if (rejection === undefined) {
      unexpected.push(
        `${spec.label}: unexpected error class ${
          call.errorCode ?? '(no code)'
        } — ${truncate(call.errorText ?? '', 240)}`
      );
      return;
    }
    observed[rejection] = (observed[rejection] ?? 0) + 1;
  });

  // --- Harness self-report: one report per observed rejection ---------------
  const reported: Record<string, number> = {};
  const reportFailures: string[] = [];
  const reportsByBusiness: Array<{ businessId: string; code: string }> = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (call.ok) {
      continue;
    }
    const rejection =
      call.errorCode === null ? undefined : REJECTION_CODE_BY_ERROR[call.errorCode];
    if (rejection === undefined) {
      continue;
    }

    const spec = specs[index];
    try {
      await reportRejection(context, spec.businessId, rejection);
      reported[rejection] = (reported[rejection] ?? 0) + 1;
      reportsByBusiness.push({ businessId: spec.businessId, code: rejection });
    } catch (error) {
      // Never abort the run (AC-10.5): count it, record it, and let the parity
      // assertion below fail loudly.
      reportFailures.push(
        `${spec.label} (${rejection}): ${truncate(messageOf(error), 240)}`
      );
    }
  }

  // The counters are read AFTER the reports: that ordering is the cross-check.
  const after = await dumpProbe(context, businessIds);
  assert(
    after.metricCounts !== undefined && after.perBusiness !== undefined,
    'dumpProbe returned no metricCounts/perBusiness — the deployment predates #84 Task 10; deploy devProof:dumpProbe first'
  );

  // --- A1: no unexpected error class ---------------------------------------
  assert(
    unexpected.length === 0,
    `${unexpected.length} call(s) ended in an unexpected class: ${unexpected.join('; ')}`
  );

  // --- A2/A3: duplicate-key replays yield one order ------------------------
  const successfulByKey = new Map<
    string,
    Array<{ spec: LoadCallSpec; call: CallEvidence; orderId: string }>
  >();
  for (const success of successes) {
    const rows = successfulByKey.get(success.spec.idempotencyKey) ?? [];
    rows.push(success);
    successfulByKey.set(success.spec.idempotencyKey, rows);
  }

  const replayKeys = [
    ...new Set(
      specs.filter((spec) => spec.replayKey !== null).map((spec) => spec.idempotencyKey)
    ),
  ];
  assert(
    replayKeys.length === LOAD_REPLAY_PAIRS,
    `expected ${LOAD_REPLAY_PAIRS} duplicate-key pair(s), got ${replayKeys.length}`
  );

  const duplicateKeys: LoadScenarioData['duplicateKeys'] = [];
  for (const key of replayKeys) {
    const rows = successfulByKey.get(key) ?? [];
    assert(
      rows.length === 2,
      `duplicate key ${key}: expected both calls to resolve, got ${rows.length} success(es)`
    );
    const orderIds = [...new Set(rows.map((row) => row.orderId))];
    duplicateKeys.push({ key, calls: rows.length, orderIds });
    assert(
      orderIds.length === 1,
      `duplicate key ${key}: ${orderIds.length} distinct order ids returned (${JSON.stringify(
        orderIds
      )}) — INV-04 breach`
    );
    // "no duplicate receipt": a replay must return the winner's receipt, so the
    // capability token in both responses must be the same one.
    const accessTokens = new Set(
      rows.map(
        (row) => (row.call.result as { accessToken?: string } | null)?.accessToken ?? null
      )
    );
    assert(
      accessTokens.size === 1 && !accessTokens.has(null),
      `duplicate key ${key}: the replay returned a different receipt (access tokens differ)`
    );
  }

  const expectedOrders = successfulByKey.size;
  const orderDelta = after.counts.orders - before.counts.orders;
  assert(
    orderDelta === expectedOrders,
    `expected ${expectedOrders} new order(s) for ${successfulByKey.size} successful key(s), got ${orderDelta} — duplicate commit`
  );

  for (const success of successes) {
    const rowsForKey = after.orderIdempotency.filter(
      (row) => row.key === success.spec.idempotencyKey
    );
    assert(
      rowsForKey.length === 1,
      `key ${success.spec.idempotencyKey}: expected exactly 1 orderIdempotency row, got ${rowsForKey.length}`
    );
    assert(
      String(rowsForKey[0].orderId) === success.orderId,
      `key ${success.spec.idempotencyKey}: idempotency row points at ${String(
        rowsForKey[0].orderId
      )}, response returned ${success.orderId}`
    );
  }

  const eventDelta = after.counts.orderEvents - before.counts.orderEvents;
  const notificationDelta = after.counts.notifications - before.counts.notifications;
  const idempotencyDelta = after.counts.orderIdempotency - before.counts.orderIdempotency;
  assert(
    eventDelta === orderDelta,
    `expected ${orderDelta} new orderEvents row(s), got ${eventDelta}`
  );
  assert(
    notificationDelta === orderDelta,
    `expected ${orderDelta} new notification(s), got ${notificationDelta}`
  );
  assert(
    idempotencyDelta === orderDelta,
    `expected ${orderDelta} new orderIdempotency row(s), got ${idempotencyDelta}`
  );

  // --- A4: report count == observed count, per code ------------------------
  assert(
    reportFailures.length === 0,
    `${reportFailures.length} rejection self-report(s) failed (counted, not fatal): ${reportFailures.join(
      '; '
    )}`
  );
  for (const code of REJECTION_CODES) {
    assert(
      (reported[code] ?? 0) === (observed[code] ?? 0),
      `rejection ${code}: observed ${observed[code] ?? 0}, reported ${reported[code] ?? 0}`
    );
  }

  // --- A5: counter delta == what the harness reported, per code -----------
  const counterDeltas: Record<string, number> = {};
  for (const code of REJECTION_CODES) {
    counterDeltas[code] =
      (after.metricCounts?.[code] ?? 0) - (before.metricCounts?.[code] ?? 0);
    assert(
      counterDeltas[code] === (reported[code] ?? 0),
      `counter delta for ${code}: reported ${reported[code] ?? 0}, dumpProbe read ${counterDeltas[code]}`
    );
  }

  // --- A6: counters are attributed to the business that rejected ----------
  const perBusinessCounters: LoadScenarioData['perBusinessCounters'] = [];
  for (const business of context.businesses) {
    const beforeBusiness = before.perBusiness?.find(
      (row) => row.businessId === business.businessId
    );
    const afterBusiness = after.perBusiness?.find(
      (row) => row.businessId === business.businessId
    );
    for (const code of REJECTION_CODES) {
      const reportedForBusiness = reportsByBusiness.filter(
        (row) => row.businessId === business.businessId && row.code === code
      ).length;
      const delta =
        (afterBusiness?.metricCounts[code] ?? 0) - (beforeBusiness?.metricCounts[code] ?? 0);
      if (reportedForBusiness > 0 || delta !== 0) {
        perBusinessCounters.push({
          businessId: business.businessId,
          code,
          reported: reportedForBusiness,
          delta,
        });
      }
      assert(
        delta === reportedForBusiness,
        `business ${business.businessId} ${code}: reported ${reportedForBusiness}, counter delta ${delta}`
      );
    }
  }

  // --- A7: latency sample (p50/p95 from the timed HTTP path) --------------
  const durations = calls
    .map((call) => call.finishedAtMs - call.startedAtMs)
    .sort((left, right) => left - right);
  const latency = {
    sampleSize: durations.length,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    min: durations[0] ?? null,
    max: durations[durations.length - 1] ?? null,
  };
  assert(
    latency.sampleSize === LOAD_TOTAL_CALLS,
    `latency sample must cover every call: expected ${LOAD_TOTAL_CALLS}, got ${latency.sampleSize}`
  );

  // --- A8: OCC retries observed through the log join ----------------------
  await sleep(LOG_SETTLE_MS);
  const burstCalls = context.calls.filter((call) => call.scenarioId === 5);
  joinCallsToLogs(burstCalls, context.capture.records);
  const joined = burstCalls.filter((call) => call.records !== null).length;
  const callsWithConflict = burstCalls.filter((call) =>
    (call.records ?? []).some((record) => hasConflict(record))
  ).length;
  const conflictingRecords = burstCalls.reduce(
    (total, call) => total + (call.records ?? []).filter((record) => hasConflict(record)).length,
    0
  );
  assert(
    joined > 0,
    'no burst call could be joined to a deployment log record — OCC/latency evidence would be empty (is the log capture running?)'
  );
  if (callsWithConflict === 0) {
    outcome.notes.push(
      'no `occInfo`/`willRetry` conflict was observed in the burst; the 100 calls did not produce a lost-update retry on this run. Outcome-correctness and latency still hold; the OCC observation is recorded as zero rather than asserted.'
    );
  }

  const outcomeCounts = {
    total: calls.length,
    success: successes.length,
    expectedRejection: calls.length - successes.length - unexpected.length,
    unexpected: unexpected.length,
  };

  outcome.assertions.push(
    `${outcomeCounts.total} concurrent placeOrder calls across ${context.businesses.length} businesses (${LOAD_CALLS_PER_BUSINESS} each), ${outcomeCounts.success} success / ${outcomeCounts.expectedRejection} expected rejection / ${outcomeCounts.unexpected} unexpected`
  );
  outcome.assertions.push(
    `${replayKeys.length} duplicate-key pair(s): both calls resolved with one order id each; exactly 1 orderIdempotency row per successful key`
  );
  outcome.assertions.push(
    `row deltas match the ${expectedOrders} successful key(s): orders ${orderDelta}, orderEvents ${eventDelta}, notifications ${notificationDelta}, orderIdempotency ${idempotencyDelta}`
  );
  outcome.assertions.push(
    `rejection self-report parity per code (${REJECTION_CODES.map(
      (code) => `${code}=${reported[code] ?? 0}`
    ).join(', ')})`
  );
  outcome.assertions.push(
    `counter deltas read back from dumpProbe match the reports (${REJECTION_CODES.map(
      (code) => `${code}=${counterDeltas[code]}`
    ).join(', ')})`
  );
  outcome.assertions.push(
    `latency over ${latency.sampleSize} timed calls: p50 ${latency.p50 ?? '—'} ms, p95 ${latency.p95 ?? '—'} ms`
  );
  outcome.assertions.push(
    `OCC observation: ${joined}/${burstCalls.length} calls joined to log records, ${callsWithConflict} call(s) show occInfo/willRetry, ${conflictingRecords} conflicting record(s)`
  );

  outcome.data = {
    businessIds,
    outcomeCounts,
    observed,
    reported,
    reportFailures,
    counterDeltas,
    perBusinessCounters,
    latency,
    occ: { joined, callsWithConflict, conflictingRecords },
    duplicateKeys,
    dump: after,
  } satisfies LoadScenarioData;
}

// ---------------------------------------------------------------------------
// Scenario driver
// ---------------------------------------------------------------------------

async function runScenario(
  context: RunContext,
  id: number,
  title: string,
  body: (outcome: ScenarioOutcome) => Promise<void>
): Promise<void> {
  const outcome: ScenarioOutcome = {
    id,
    title,
    verdict: 'PASS',
    assertions: [],
    failures: [],
    notes: [],
    blockedReason: null,
    calls: [],
    data: {},
  };

  try {
    await body(outcome);
  } catch (error) {
    if (error instanceof ProofBlockedError) {
      outcome.verdict = 'BLOCKED';
      outcome.blockedReason = error.message;
    } else {
      outcome.verdict = 'FAIL';
      outcome.failures.push(messageOf(error));
    }
  }

  // Calls register themselves on the run context; the scenario keeps its own
  // view for rendering.
  outcome.calls = context.calls.filter((call) => call.scenarioId === id);

  context.scenarios.push(outcome);
  console.log(`[scenario ${id}] ${outcome.verdict} — ${title}`);
  for (const failure of outcome.failures) {
    console.error(`  FAIL: ${failure}`);
  }
  if (outcome.blockedReason !== null) {
    console.error(`  BLOCKED: ${outcome.blockedReason}`);
  }
}

// ---------------------------------------------------------------------------
// Evidence rendering
// ---------------------------------------------------------------------------

function renderLogFields(call: CallEvidence): string {
  if (call.records === null || call.records.length === 0) {
    return call.joinNote ?? 'not correlated';
  }
  return call.records
    .map((record) => {
      const parts = [
        `requestId=${record.requestId ?? '—'}`,
        `executionId=${record.executionId ?? '—'}`,
        `caller=${record.caller ?? '—'}`,
        `identityType=${record.identityType ?? '—'}`,
        `executionTime=${record.executionTime ?? '—'}s`,
        `occInfo=${record.occInfo == null ? 'null' : JSON.stringify(record.occInfo)}`,
        `willRetry=${String(record.willRetry)}`,
      ];
      return parts.join(' · ');
    })
    .join('<br>');
}

function renderCallTable(calls: CallEvidence[]): string[] {
  const lines: string[] = [];
  lines.push(
    '| call | transport | function | marker | start (UTC) | end (UTC) | ms | outcome | requestId | executionId | caller | identityType | executionTime | occInfo | willRetry |'
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const call of calls) {
    // Show the conflicting attempt when one exists: the retry that follows it
    // is the one that looks clean, and the conflict is the evidence.
    const record =
      call.records?.find((candidate) => hasConflict(candidate)) ?? call.records?.[0];
    lines.push(
      [
        '',
        cell(call.label, 40),
        call.transport,
        `\`${call.functionName}\``,
        `\`${cell(call.marker, 80)}\``,
        iso(call.startedAtMs),
        iso(call.finishedAtMs),
        String(call.finishedAtMs - call.startedAtMs),
        call.ok ? 'ok' : '**error**',
        record?.requestId ?? call.requestIdFromError ?? '—',
        record?.executionId ?? '—',
        record?.caller ?? '—',
        record?.identityType ?? '—',
        record?.executionTime == null ? '—' : `${record.executionTime}s`,
        record?.occInfo == null ? 'null' : `\`${cell(record.occInfo, 160)}\``,
        record == null ? '—' : String(record.willRetry),
        '',
      ].join(' | ')
    );
  }
  lines.push('');
  for (const call of calls) {
    if (call.joinNote !== null) {
      lines.push(`- **Join note (${call.label}):** ${call.joinNote}`);
    }
    if (call.records !== null && call.records.length > 1) {
      lines.push(
        `- **${call.label}:** ${call.records.length} Completion records share this request id (retry attempts): ${call.records.map((record) => String(record.executionId)).join(', ')}`
      );
    }
  }
  return lines;
}

function renderCallDetail(calls: CallEvidence[]): string[] {
  const lines: string[] = [];
  for (const call of calls) {
    lines.push(`#### ${call.label} — \`${call.functionName}\``);
    lines.push('');
    lines.push(`- marker: \`${call.marker}\``);
    lines.push(`- result: \`${cell(call.result, 400)}\``);
    lines.push(`- log fields: ${renderLogFields(call)}`);
    if (call.requestIdFromError !== null) {
      lines.push(`- \`[Request ID: …]\` from the failure text: \`${call.requestIdFromError}\``);
    }
    if (call.errorText !== null) {
      lines.push('');
      lines.push('```text');
      lines.push(call.errorText);
      lines.push('```');
    }
    lines.push('');
  }
  return lines;
}

function renderOrders(rows: ProbeOrder[]): string[] {
  const lines: string[] = [];
  lines.push('| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${row._id}\` | ${row.status} | ${cell(row.statusReason ?? '—', 60)} | ${iso(
        row.createdAt
      )} | ${row.statusUpdatedAt === undefined ? '—' : iso(row.statusUpdatedAt)} | ${
        row.subtotal ?? '—'
      } |`
    );
  }
  return lines;
}

function renderEvents(rows: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  lines.push('| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${String(row._id)}\` | \`${String(row.orderId)}\` | ${String(
        row.actorType
      )} | ${cell(row.actorUserId ?? '—', 40)} | ${String(row.action)} | ${String(
        row.fromStatus ?? '—'
      )} | ${String(row.toStatus)} | ${cell(row.reason ?? '—', 60)} | ${iso(
        Number(row.createdAt)
      )} |`
    );
  }
  return lines;
}

function renderNotifications(rows: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  lines.push('| notification id | userId | businessId | type | createdAt (UTC) |');
  lines.push('|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${String(row._id)}\` | \`${String(row.userId)}\` | \`${String(
        row.businessId
      )}\` | ${String(row.type)} | ${iso(Number(row.createdAt))} |`
    );
  }
  return lines;
}

function renderIdempotency(rows: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  lines.push('| id | key | orderId | argsHash (short) | createdAt (UTC) |');
  lines.push('|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${String(row._id)}\` | \`${String(row.key)}\` | \`${String(
        row.orderId
      )}\` | \`${String(row.argsHash).slice(0, 16)}…\` | ${iso(Number(row.createdAt))} |`
    );
  }
  return lines;
}

function renderThrottle(rows: Array<{ key: string; windowStart: number; count: number }>): string[] {
  const lines: string[] = [];
  lines.push('| key | windowStart (UTC) | count |');
  lines.push('|---|---|---|');
  for (const row of rows) {
    lines.push(`| \`${row.key}\` | ${iso(row.windowStart)} | ${row.count} |`);
  }
  return lines;
}

function renderBlocks(rows: Array<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  lines.push('| id | businessId | contactHash (short) | createdAt (UTC) |');
  lines.push('|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${String(row._id)}\` | \`${String(row.businessId)}\` | \`${String(
        row.contactHash
      ).slice(0, 16)}…\` | ${iso(Number(row.createdAt))} |`
    );
  }
  return lines;
}

function renderDump(dump: ProbeDump): string[] {
  const lines: string[] = [];
  lines.push('**Counts:**');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(dump.counts, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('**Orders:**');
  lines.push('');
  lines.push(...renderOrders(dump.orders));
  lines.push('');
  lines.push('**orderEvents:**');
  lines.push('');
  lines.push(...renderEvents(dump.orderEvents));
  lines.push('');
  lines.push('**notifications:**');
  lines.push('');
  lines.push(...renderNotifications(dump.notifications));
  lines.push('');
  lines.push('**orderIdempotency:**');
  lines.push('');
  lines.push(...renderIdempotency(dump.orderIdempotency));
  lines.push('');
  lines.push('**orderThrottle:**');
  lines.push('');
  lines.push(...renderThrottle(dump.orderThrottle));
  lines.push('');
  lines.push('**orderBlocks:**');
  lines.push('');
  lines.push(...renderBlocks(dump.orderBlocks));
  lines.push('');
  return lines;
}

/**
 * The `load100`-specific evidence tables (Task 11 consumes these field names):
 * outcome classes, latency, OCC retries, per-code report/counter parity, and the
 * duplicate-key replay rows.
 */
function renderLoadScenario(data: LoadScenarioData): string[] {
  const lines: string[] = [];

  lines.push('### load100 — outcome classes');
  lines.push('');
  lines.push('| class | count |');
  lines.push('|---|---|');
  lines.push(`| success | ${data.outcomeCounts.success} |`);
  lines.push(`| expected rejection | ${data.outcomeCounts.expectedRejection} |`);
  lines.push(`| unexpected | ${data.outcomeCounts.unexpected} |`);
  lines.push(`| total | ${data.outcomeCounts.total} |`);
  lines.push('');

  lines.push('### load100 — end-to-end latency (`timedHttpMutation`, client wall clock)');
  lines.push('');
  lines.push('| sample | p50 | p95 | min | max |');
  lines.push('|---|---|---|---|---|');
  lines.push(
    `| ${data.latency.sampleSize} | ${data.latency.p50 ?? '—'} ms | ${
      data.latency.p95 ?? '—'
    } ms | ${data.latency.min ?? '—'} ms | ${data.latency.max ?? '—'} ms |`
  );
  lines.push('');

  lines.push('### load100 — OCC retries (deployment log join)');
  lines.push('');
  lines.push('| calls joined | calls with occInfo/willRetry | conflicting records |');
  lines.push('|---|---|---|');
  lines.push(
    `| ${data.occ.joined} | ${data.occ.callsWithConflict} | ${data.occ.conflictingRecords} |`
  );
  lines.push('');

  lines.push('### load100 — rejection cross-check (observed → self-reported → counter delta)');
  lines.push('');
  lines.push('| code | observed | reported | counter delta |');
  lines.push('|---|---|---|---|');
  for (const code of REJECTION_CODES) {
    lines.push(
      `| \`${code}\` | ${data.observed[code] ?? 0} | ${data.reported[code] ?? 0} | ${
        data.counterDeltas[code] ?? 0
      } |`
    );
  }
  lines.push('');
  if (data.reportFailures.length > 0) {
    lines.push('Self-report failures:');
    lines.push('');
    for (const failure of data.reportFailures) {
      lines.push(`- ${failure}`);
    }
    lines.push('');
  }

  lines.push('### load100 — per-business counter attribution');
  lines.push('');
  if (data.perBusinessCounters.length === 0) {
    lines.push('_No business recorded a rejection; every counter delta is zero._');
    lines.push('');
  } else {
    lines.push('| business | code | reported | counter delta |');
    lines.push('|---|---|---|---|');
    for (const row of data.perBusinessCounters) {
      lines.push(
        `| \`${row.businessId}\` | \`${row.code}\` | ${row.reported} | ${row.delta} |`
      );
    }
    lines.push('');
  }

  lines.push('### load100 — duplicate-key replays (INV-04)');
  lines.push('');
  lines.push('| key | calls | order ids |');
  lines.push('|---|---|---|');
  for (const row of data.duplicateKeys) {
    lines.push(
      `| \`${row.key}\` | ${row.calls} | ${row.orderIds.map((id) => `\`${id}\``).join(', ')} |`
    );
  }
  lines.push('');

  return lines;
}

function renderEvidence(context: RunContext): string {
  const lines: string[] = [];
  const verdict: 'PASS' | 'FAIL' | 'BLOCKED' =
    context.fatal !== null || context.scenarios.some((scenario) => scenario.verdict === 'FAIL')
      ? 'FAIL'
      : context.scenarios.some((scenario) => scenario.verdict === 'BLOCKED')
        ? 'BLOCKED'
        : 'PASS';
  // A run that includes `load100` is #84 evidence; a scenarios 1–4 run keeps
  // the #81 record. `main` writes to the matching path.
  const isLoadRun = context.scenarios.some((scenario) => scenario.id === 5);

  lines.push(
    isLoadRun
      ? '# Issue #84 — order-protocol load test evidence (T10 / Phase 5)'
      : '# Issue #81 — order-protocol concurrency evidence (T9 / Phase 5)'
  );
  lines.push('');
  lines.push('**Verdict: ' + verdict + '**');
  lines.push('');
  lines.push('| field | value |');
  lines.push('|---|---|');
  lines.push(
    isLoadRun
      ? '| Issue | #84 — order-protocol measurement + hardening (T10 100-way load test) |'
      : '| Issue | #81 — order commitment protocol hardening (T9 concurrency proof) |'
  );
  lines.push(`| Branch | \`${context.branch}\` |`);
  lines.push(`| Deployment | \`${context.deploymentUrl}\` |`);
  lines.push(`| Run id | \`${context.runId}\` |`);
  lines.push(`| Node | \`${context.nodeVersion}\` |`);
  lines.push(`| Generated at | ${context.startedAt.toISOString()} |`);
  lines.push(`| Command | \`${context.command}\` |`);
  lines.push(
    `| Probe business | \`${context.businessId}\` · menu item \`${context.menuItemId}\` |`
  );
  if (isLoadRun) {
    lines.push(
      `| Probe businesses | ${context.businesses.length} seeded: ${context.businesses
        .map((business) => `\`${business.businessId}\``)
        .join(', ')} |`
    );
  }
  lines.push('');
  lines.push('Scenarios: §7.3 `docs/order-commitment-protocol.md` L1740–1749.');
  if (isLoadRun) {
    lines.push(
      `load100: ${LOAD_BUSINESS_COUNT} businesses × ${LOAD_CALLS_PER_BUSINESS} concurrent \`placeOrder\` = ${LOAD_TOTAL_CALLS} calls; ${LOAD_REPLAY_PAIRS} duplicate-key pair(s); ${LOAD_DISTINCT_SUBMISSIONS} distinct contacts (plan D8 / §4.5).`
    );
  }
  lines.push('');

  if (context.fatal !== null) {
    lines.push('## Fatal error');
    lines.push('');
    lines.push('```text');
    lines.push(context.fatal);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Scenario results');
  lines.push('');
  lines.push('| # | scenario | verdict |');
  lines.push('|---|---|---|');
  for (const scenario of context.scenarios) {
    lines.push(`| ${scenario.id} | ${scenario.title} | **${scenario.verdict}** |`);
  }
  lines.push('');

  for (const scenario of context.scenarios) {
    lines.push(`## Scenario ${scenario.id} — ${scenario.title}`);
    lines.push('');
    lines.push(`**Verdict: ${scenario.verdict}**`);
    lines.push('');
    if (scenario.assertions.length > 0) {
      lines.push('Asserted:');
      lines.push('');
      for (const assertion of scenario.assertions) {
        lines.push(`- ${assertion}`);
      }
      lines.push('');
    }
    if (scenario.failures.length > 0) {
      lines.push('Failures:');
      lines.push('');
      for (const failure of scenario.failures) {
        lines.push(`- **FAIL:** ${failure}`);
      }
      lines.push('');
    }
    if (scenario.blockedReason !== null) {
      lines.push(`- **BLOCKED:** ${scenario.blockedReason}`);
      lines.push('');
    }
    if (scenario.notes.length > 0) {
      for (const note of scenario.notes) {
        lines.push(`- Note: ${note}`);
      }
      lines.push('');
    }
    lines.push(...renderCallTable(scenario.calls));
    lines.push('');
    lines.push(...renderCallDetail(scenario.calls));

    if (scenario.id === 5) {
      const loadData = scenario.data as unknown as Partial<LoadScenarioData>;
      // On a thrown setup failure the scenario has no data; the failure text
      // above already says why, so only render when the shape is complete.
      if (loadData.outcomeCounts !== undefined && loadData.dump !== undefined) {
        lines.push(...renderLoadScenario(loadData as LoadScenarioData));
        lines.push('### load100 — final rows per business (before cleanup)');
        lines.push('');
        const perBusiness = loadData.dump.perBusiness ?? [];
        lines.push('| business | name | orders | orderEvents | notifications | idempotency | throttle | counters |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (const row of perBusiness) {
          lines.push(
            `| \`${row.businessId}\` | ${cell(row.name, 80)} | ${row.counts.orders ?? 0} | ${
              row.counts.orderEvents ?? 0
            } | ${row.counts.notifications ?? 0} | ${row.counts.orderIdempotency ?? 0} | ${
              row.counts.orderThrottle ?? 0
            } | ${row.counts.orderMetricCounters ?? 0} |`
          );
        }
        lines.push('');
      }
    }

    if (scenario.id === 1) {
      for (const attempt of [1, 2]) {
        const data = scenario.data[`attempt${attempt}`] as
          | { idempotencyKey: string; orderId: string; dump: ProbeDump }
          | undefined;
        if (data === undefined) {
          continue;
        }
        lines.push(`### Scenario 1 attempt ${attempt} — rows after the pair`);
        lines.push('');
        lines.push(`Idempotency key: \`${data.idempotencyKey}\` · order: \`${data.orderId}\``);
        lines.push('');
        lines.push(...renderDump(data.dump));
      }
      if (scenario.data.noConflictInline === true) {
        lines.push(
          '> **Outcome-correctness only:** neither attempt exposed a non-null `occInfo` or `willRetry: true` in the deployment log stream. See the verdict note below.'
        );
        lines.push('');
      }
    }

    if (scenario.id >= 2 && scenario.id <= 4) {
      const orderId = scenario.data.orderId as string | undefined;
      if (scenario.id === 4) {
        lines.push(
          `Pair fired at ${String(scenario.data.firedAtIso)} (wall clock); the cron interval is 5 minutes and its phase is not exposed.`
        );
        lines.push('');
      }
      if (orderId !== undefined) {
        lines.push(`### Scenario ${scenario.id} — final rows for order \`${orderId}\``);
        lines.push('');
        const dump = scenario.data.dump as ProbeDump | undefined;
        if (dump !== undefined) {
          lines.push('**Order:**');
          lines.push('');
          lines.push(...renderOrders(dump.orders.filter((order) => order._id === orderId)));
          lines.push('');
          lines.push('**orderEvents:**');
          lines.push('');
          lines.push(
            ...renderEvents(dump.orderEvents.filter((event) => event.orderId === orderId))
          );
          lines.push('');
          lines.push('**Full probe counts at this point:**');
          lines.push('');
          lines.push('```json');
          lines.push(JSON.stringify(dump.counts, null, 2));
          lines.push('```');
          lines.push('');
        }
      }
    }
  }

  lines.push('## Final probe rows (before cleanup)');
  lines.push('');
  if (context.finalDump === null) {
    lines.push('_No final dump was captured._');
    lines.push('');
  } else {
    lines.push(...renderDump(context.finalDump));
  }

  lines.push('## Cron interference');
  lines.push('');
  const sweeps = context.capture.records.filter(
    (record) => record.identifier === 'orderExpiry:sweepExpiredOrders'
  );
  lines.push(
    `\`orderExpiry:sweepExpiredOrders\` executions observed in the capture window: **${sweeps.length}**.`
  );
  if (sweeps.length > 0) {
    lines.push('');
    for (const sweep of sweeps) {
      lines.push(
        `- requestId \`${sweep.requestId ?? '—'}\` at ${iso(serverMs(sweep))} (caller \`${sweep.caller ?? '—'}\`)`
      );
    }
  }
  lines.push('');
  lines.push(
    'The dev deployment runs `crons.interval("sweep expired orders", { minutes: 5 }, …)`; scenario 4 creates its due row immediately before the pair, so this count bounds (but cannot eliminate) sweep interference.'
  );
  lines.push('');

  lines.push('## Limitations (explicit)');
  lines.push('');
  lines.push(
    '1. **No client-side request id.** Convex does not expose a request id on the `ConvexHttpClient` result (`node_modules/convex/dist/esm/browser/http_client.js` has no request-id handling). Ids here are correlated from the deployment log stream (`node node_modules/convex/bin/main.js logs --jsonl --success --history 0`), started before the scenarios and stopped afterwards. Records are grouped by `requestId` first — a mutation that conflicts is retried inside the same HTTP request, so its conflict attempt and its retry share one id (`occInfo` + `willRetry: true` on the first, clean on the second). Failed CLI calls additionally print `[Request ID: …]`, matched exactly; the remaining calls take the nearest unclaimed group with the same `identifier` inside ±5 s of the call finishing. A call that cannot be joined says so in its row.'
  );
  lines.push(
    '2. **`--identity` is impersonation, not authentication.** Owner-side calls run the public `orders:transitionOrderStatus` through `convex run --identity \'{"subject":"<owner>"}\'`, which authenticates with the developer’s deployment admin key and makes `ctx.auth.getUserIdentity()` return the injected subject. The deployment logs these executions as `identityType: "member_acting_user"`. This requires a logged-in developer and must never reach a browser or CI.'
  );
  lines.push(
    '2a. **`ConvexHttpClient` queues mutations by default.** `mutation()` pushes onto a per-instance `mutationQueue` and processes one at a time (`node_modules/convex/dist/esm/browser/http_client.js` L302–323), so two calls in one `Promise.all` are serialized unless the documented `{ skipQueue: true }` option is passed (`http_client.d.ts` L10–15). Scenario 1 passes it, and warms the connection pool first, so the two `placeOrder` mutations are genuinely in flight together. A harness that omits `skipQueue` cannot produce this race.'
  );
  lines.push(
    '3. **The 5-minute expiry cron runs concurrently** on this shared dev deployment (see above). Scenario 4 accepts that a sweep may win the race before the pair fires; the assertions hold for either winner.'
  );
  lines.push(
    '4. **Shared dev data.** Every fixture is scoped by the run id (`__T9 proof <runId>__` and `__T9 proof <runId> #2..10__` businesses); no pilot or seed row is read or written by the harness.'
  );
  lines.push(
    '5. **No `convex-test` substitute.** These results come from the real deployment’s serializable transactions; `convex-test` executes mutations serially and cannot prove OCC behavior (protocol L1742).'
  );
  if (isLoadRun) {
    lines.push(
      `6. **load100 fan-out and self-reporting.** ${LOAD_TOTAL_CALLS} calls across ${LOAD_BUSINESS_COUNT} businesses (${LOAD_CALLS_PER_BUSINESS} each) with ${LOAD_REPLAY_PAIRS} duplicate-key pair(s). \`TOO_MANY_REQUESTS\`, \`ORDER_NOT_ACCEPTED\`, and the other mapped typed codes are counted as expected rejections and self-reported through \`orderMetrics:recordOrderRejection\` (client-reported, best-effort, D4) — the counter deltas are therefore a measurement of this harness's own reports, not of every caller on the deployment. A replay pair shares one contact by necessity: the args hash covers the contact, so a different phone would be \`IDEMPOTENCY_CONFLICT\`, not a replay.`
    );
    lines.push(
      `7. **OCC observation is not an assertion.** A zero \`occInfo\`/\`willRetry\` count means the burst did not produce a lost-update retry on this run; the run still proves outcome-correctness and latency. Only a completely unjoined log capture fails the scenario.`
    );
  }
  lines.push('');

  lines.push('## Cleanup');
  lines.push('');
  lines.push('`devProof:cleanupProbe` runs in a `finally` block, including on failure.');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(context.cleanup ?? null, null, 2));
  lines.push('```');
  lines.push('');

  // Reuse the log-file path only as a local debugging aid; it is outside the repo.
  lines.push(`Log stream dump (local, not committed): \`${logDumpPath}\``);
  lines.push('');
  lines.push(`**VERDICT: ${verdict}**`);
  lines.push('');

  return redactAccessTokens(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function branchName(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<number> {
  const startedAt = new Date();
  const runId = `proof-${Date.now()}`;

  const parsed = parseCli(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  const options = parsed.options;

  // Wired-but-not-run check: exits before the env check, log capture, seed,
  // mutations, evidence write, and cleanup. No Convex contact of any kind.
  if (options.dryRun) {
    printDryRun(options);
    return 0;
  }

  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (deploymentUrl === undefined || deploymentUrl.length === 0) {
    console.error(
      'NEXT_PUBLIC_CONVEX_URL is missing — run with `node --env-file=.env.local scripts/order-concurrency-proof.ts`'
    );
    return 1;
  }

  const context: RunContext = {
    runId,
    command: invocationFor(options.scenario),
    deploymentUrl,
    nodeVersion: process.version,
    branch: branchName(),
    startedAt,
    businessId: '',
    menuItemId: '',
    ownerExternalId: 'seed-owner-localconnect',
    businesses: [],
    client: new ConvexHttpClient(deploymentUrl),
    capture: startLogCapture(),
    calls: [],
    scenarios: [],
    finalDump: null,
    cleanup: null,
    fatal: null,
  };

  console.log(`run ${runId} against ${deploymentUrl} (scenario ${options.scenario})`);

  try {
    const seed = (await runCliJson('devProof:seedProbe', { runId })) as {
      businessId: string;
      menuItemId: string;
      ownerExternalId: string;
      businesses?: ProbeBusiness[];
    };
    context.businessId = seed.businessId;
    context.menuItemId = seed.menuItemId;
    context.ownerExternalId = seed.ownerExternalId;
    // A stale deployment's `seedProbe` returns only the pre-#84 single business;
    // `load100` turns that into a BLOCKED scenario, not a silently different test.
    context.businesses =
      seed.businesses ?? [
        {
          businessId: seed.businessId,
          menuItemId: seed.menuItemId,
          name: 'probe',
          contactPhonePrefix: '+15550',
        },
      ];
    console.log(
      `probe businesses: ${context.businesses.length} (first ${seed.businessId}, owner ${seed.ownerExternalId})`
    );

    await warmHttpClient(context);

    const wantsScenario = (id: number): boolean =>
      options.scenario === 'all' || options.scenario === String(id);

    if (wantsScenario(1)) {
      await runScenario(
        context,
        1,
        'two placeOrder, same (businessId, idempotencyKey), same args',
        (outcome) => scenario1(context, outcome)
      );
    }
    if (wantsScenario(2)) {
      await runScenario(context, 2, 'accept vs decline in parallel', (outcome) =>
        scenario2(context, outcome)
      );
    }
    if (wantsScenario(3)) {
      await runScenario(context, 3, 'two accepts in parallel', (outcome) =>
        scenario3(context, outcome)
      );
    }
    if (wantsScenario(4)) {
      await runScenario(context, 4, 'expire vs accept in parallel on a due order', (outcome) =>
        scenario4(context, outcome)
      );
    }
    if (options.scenario === 'all' || options.scenario === 'load100') {
      await runScenario(
        context,
        5,
        `${LOAD_TOTAL_CALLS} concurrent placeOrder across ${LOAD_BUSINESS_COUNT} businesses (${LOAD_CALLS_PER_BUSINESS} each, ${LOAD_REPLAY_PAIRS} duplicate-key pairs)`,
        (outcome) => scenario5(context, outcome)
      );
    }
  } catch (error) {
    context.fatal = messageOf(error);
    console.error(`fatal: ${context.fatal}`);
  } finally {
    // Let the log stream deliver the last records before stopping it.
    await sleep(LOG_SETTLE_MS);
    await context.capture.stop();
  }

  // Join every call to the (now complete) log stream, then decide the final
  // verdicts — scenario 1's BLOCKED rule needs the finished stream.
  joinCallsToLogs(context.calls, context.capture.records);
  console.log(`log records captured: ${context.capture.records.length}`);

  for (const scenario of context.scenarios) {
    if (scenario.verdict !== 'PASS') {
      continue;
    }
    if (scenario.id !== 1) {
      continue;
    }
    const scen1Calls = context.calls.filter((call) => call.scenarioId === 1);
    const conflicted = scen1Calls.some((call) =>
      (call.records ?? []).some((record) => hasConflict(record))
    );
    if (!conflicted) {
      scenario.verdict = 'BLOCKED';
      scenario.blockedReason =
        'No OCC conflict observed in either scenario-1 attempt (`occInfo` null and `willRetry` false on every correlated record): outcome-correctness only, no observed conflict. Escalate per plan Risks row 1.';
    } else {
      scenario.assertions.push(
        'at least one placeOrder execution shows `occInfo` non-null / `willRetry: true` in the log stream'
      );
    }
  }

  // Final rows + cleanup always run, in that order, even after a fatal error.
  if (context.businessId !== '') {
    try {
      const finalBusinessIds =
        options.scenario === 'all' || options.scenario === 'load100'
          ? context.businesses.map((business) => business.businessId)
          : undefined;
      context.finalDump = await dumpProbe(context, finalBusinessIds);
    } catch (error) {
      console.error(`final dump failed: ${messageOf(error)}`);
    }
  }

  try {
    context.cleanup = await runCliJson('devProof:cleanupProbe', { runId });
  } catch (error) {
    context.fatal = `${context.fatal ?? ''}\ncleanup failed: ${messageOf(error)}`.trim();
    console.error(`cleanup failed: ${messageOf(error)}`);
  }

  const verdict: 'PASS' | 'FAIL' | 'BLOCKED' =
    context.fatal !== null || context.scenarios.some((scenario) => scenario.verdict === 'FAIL')
      ? 'FAIL'
      : context.scenarios.some((scenario) => scenario.verdict === 'BLOCKED')
        ? 'BLOCKED'
        : 'PASS';

  const evidencePath = evidencePathFor(options.scenario);
  writeFileSync(evidencePath, renderEvidence(context), 'utf8');

  console.log('');
  console.log('scenario summary');
  for (const scenario of context.scenarios) {
    console.log(`  ${scenario.id}. ${scenario.verdict.padEnd(7)} ${scenario.title}`);
  }
  if (context.fatal !== null) {
    console.log(`  fatal: ${context.fatal}`);
  }
  console.log(`evidence: ${path.relative(repoRoot, evidencePath)}`);
  console.log(`verdict: ${verdict}`);

  return verdict === 'PASS' ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
