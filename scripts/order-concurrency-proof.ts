#!/usr/bin/env node
/**
 * Issue #81 / T9 — order-protocol concurrency proof harness (real dev deployment).
 *
 * Runs the four §7.3 races (`docs/order-commitment-protocol.md` L1740–1749)
 * against a live Convex deployment and records per-call request ids, OCC fields,
 * and the final rows in `tasks/issue-81-concurrency-evidence.md`:
 *
 *   1. two `placeOrder` with the same `(businessId, idempotencyKey)` + same args;
 *   2. `accept` vs `decline` on one order;
 *   3. two `accept` on one order;
 *   4. `orderExpiry:expireOrder` vs `accept` on one due order.
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
 *
 * Exit codes: 0 = every scenario asserted PASS; 1 = FAIL or BLOCKED.
 * BLOCKED means scenario 1 produced no observable OCC conflict after two
 * attempts, so the run proves outcome-correctness only (plan Risks row 1).
 *
 * Read-only with respect to the repository except for the evidence markdown.
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
const evidencePath = path.join(repoRoot, 'tasks', 'issue-81-concurrency-evidence.md');
const logDumpPath = path.join(
  process.env.TEMP ?? repoRoot,
  `t9-concurrency-logs-${Date.now()}.jsonl`
);

/** `convex/devProof.ts` `PROBE_ITEM_PRICE_CENTS`. */
const PROBE_ITEM_PRICE_CENTS = 1_250;
const PROBE_CUSTOMER_NAME = 'T9 Concurrency Probe';
const PROBE_CONTACT_PHONE = '+15550199001';

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
  try {
    result = await callByName.call(context.client, functionName, args, {
      skipQueue: true,
    });
    ok = true;
  } catch (error) {
    errorText = truncate(messageOf(error), 1_500);
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

async function dumpProbe(context: RunContext): Promise<ProbeDump> {
  const value = (await runCliJson('devProof:dumpProbe', {
    runId: context.runId,
    businessId: context.businessId,
  })) as ProbeDump;
  return value;
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

function renderEvidence(context: RunContext): string {
  const lines: string[] = [];
  const verdict: 'PASS' | 'FAIL' | 'BLOCKED' =
    context.fatal !== null || context.scenarios.some((scenario) => scenario.verdict === 'FAIL')
      ? 'FAIL'
      : context.scenarios.some((scenario) => scenario.verdict === 'BLOCKED')
        ? 'BLOCKED'
        : 'PASS';

  lines.push('# Issue #81 — order-protocol concurrency evidence (T9 / Phase 5)');
  lines.push('');
  lines.push('**Verdict: ' + verdict + '**');
  lines.push('');
  lines.push('| field | value |');
  lines.push('|---|---|');
  lines.push('| Issue | #81 — order commitment protocol hardening (T9 concurrency proof) |');
  lines.push(`| Branch | \`${context.branch}\` |`);
  lines.push(`| Deployment | \`${context.deploymentUrl}\` |`);
  lines.push(`| Run id | \`${context.runId}\` |`);
  lines.push(`| Node | \`${context.nodeVersion}\` |`);
  lines.push(`| Generated at | ${context.startedAt.toISOString()} |`);
  lines.push(`| Command | \`${context.command}\` |`);
  lines.push(
    `| Probe business | \`${context.businessId}\` · menu item \`${context.menuItemId}\` |`
  );
  lines.push('');
  lines.push('Scenarios: §7.3 `docs/order-commitment-protocol.md` L1740–1749.');
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
    '4. **Shared dev data.** Every fixture is scoped by the run id (`__T9 proof <runId>__` business); no pilot or seed row is read or written by the harness.'
  );
  lines.push(
    '5. **No `convex-test` substitute.** These results come from the real deployment’s serializable transactions; `convex-test` executes mutations serially and cannot prove OCC behavior (protocol L1742).'
  );
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
  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (deploymentUrl === undefined || deploymentUrl.length === 0) {
    console.error(
      'NEXT_PUBLIC_CONVEX_URL is missing — run with `node --env-file=.env.local scripts/order-concurrency-proof.ts`'
    );
    return 1;
  }

  const context: RunContext = {
    runId,
    command: `node --env-file=.env.local ${path.relative(repoRoot, process.argv[1] ?? 'scripts/order-concurrency-proof.ts').replace(/\\/g, '/')}`,
    deploymentUrl,
    nodeVersion: process.version,
    branch: branchName(),
    startedAt,
    businessId: '',
    menuItemId: '',
    ownerExternalId: 'seed-owner-localconnect',
    client: new ConvexHttpClient(deploymentUrl),
    capture: startLogCapture(),
    calls: [],
    scenarios: [],
    finalDump: null,
    cleanup: null,
    fatal: null,
  };

  console.log(`run ${runId} against ${deploymentUrl}`);

  try {
    const seed = (await runCliJson('devProof:seedProbe', { runId })) as {
      businessId: string;
      menuItemId: string;
      ownerExternalId: string;
    };
    context.businessId = seed.businessId;
    context.menuItemId = seed.menuItemId;
    context.ownerExternalId = seed.ownerExternalId;
    console.log(`probe business ${seed.businessId} (owner ${seed.ownerExternalId})`);

    await warmHttpClient(context);

    await runScenario(context, 1, 'two placeOrder, same (businessId, idempotencyKey), same args', (outcome) =>
      scenario1(context, outcome)
    );
    await runScenario(context, 2, 'accept vs decline in parallel', (outcome) =>
      scenario2(context, outcome)
    );
    await runScenario(context, 3, 'two accepts in parallel', (outcome) =>
      scenario3(context, outcome)
    );
    await runScenario(context, 4, 'expire vs accept in parallel on a due order', (outcome) =>
      scenario4(context, outcome)
    );
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
      context.finalDump = await dumpProbe(context);
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
