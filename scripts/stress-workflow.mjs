#!/usr/bin/env node
// P-1 stress test: drive WorkflowManager at a sustained event rate and verify
// that debounced async snapshot writes keep disk I/O and memory under control.
//
// Usage:
//   node scripts/stress-workflow.mjs                   # defaults: 100 ev/s × 300s
//   node scripts/stress-workflow.mjs --duration=300 --rate=100 --threads=5
//   node scripts/stress-workflow.mjs --duration=10  --rate=200             # quick smoke

import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WorkflowManager } from '../packages/daemon/dist/daemon/workflowManager.js';

const args = parseArgs(process.argv.slice(2));
const DURATION_SEC = args.duration ?? 300;
const RATE = args.rate ?? 100;
const THREAD_COUNT = args.threads ?? 5;
const SNAPSHOT_DEBOUNCE_MS = args.debounce ?? 200;

// Acceptance thresholds — script exits non-zero if any are exceeded.
const MAX_RSS_GROWTH_MB = 200;
const MAX_APPEND_LATENCY_MS = 50;
const MAX_WRITE_RATIO = 0.10; // disk writes / events; debounce should keep ≪ 1:1

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-z][a-z-]*)=(.+)$/);
    if (!m) continue;
    const [, key, value] = m;
    const num = Number(value);
    out[key] = Number.isFinite(num) ? num : value;
  }
  return out;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

function formatMs(n) {
  return `${n.toFixed(3)}ms`;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-stress-'));
  const snapshotPath = join(dir, 'workflow-snapshot.json');

  console.log(`[stress] duration=${DURATION_SEC}s rate=${RATE}/s threads=${THREAD_COUNT} debounce=${SNAPSHOT_DEBOUNCE_MS}ms`);
  console.log(`[stress] snapshot path: ${snapshotPath}`);

  const manager = new WorkflowManager({
    snapshotPath,
    snapshotDebounceMs: SNAPSHOT_DEBOUNCE_MS,
  });

  // Seed threads. Items will round-robin across them.
  for (let i = 0; i < THREAD_COUNT; i += 1) {
    manager.upsertThread({
      id: `thread:stress-${i}`,
      source: 'cli',
      title: `stress-${i}`,
      status: 'running',
      updatedAt: Date.now(),
      itemCount: 0,
    });
  }

  // Memory sampling.
  const baseline = process.memoryUsage();
  let peakRss = baseline.rss;
  let peakHeap = baseline.heapUsed;
  const memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
  }, 1000);
  memInterval.unref();

  // Disk-write sampling. We can't intercept the manager's internal writes
  // cheaply, so we observe by polling the snapshot file's size/mtime at 50ms
  // intervals — well below the 200ms debounce, so we won't miss a write.
  let diskWrites = 0;
  let lastMtime = 0;
  let lastSize = -1;
  const diskInterval = setInterval(() => {
    if (!existsSync(snapshotPath)) return;
    try {
      const st = statSync(snapshotPath);
      const mtime = st.mtimeMs;
      const size = st.size;
      if (mtime !== lastMtime || size !== lastSize) {
        diskWrites += 1;
        lastMtime = mtime;
        lastSize = size;
      }
    } catch {
      // file mid-rename — next tick will catch up
    }
  }, 50);
  diskInterval.unref();

  // Event generation. Windows setInterval has ~15.6ms resolution, so we fire
  // batches every 50ms (= 20Hz) instead of one event per tick. Batch size
  // scales with the target rate to keep pacing accurate cross-platform.
  const totalEvents = DURATION_SEC * RATE;
  const tickHz = 20;
  const tickMs = 1000 / tickHz;
  const eventsPerTick = Math.max(1, Math.round(RATE / tickHz));
  const latencies = new Float64Array(totalEvents);
  let appended = 0;
  let skipped = 0;
  let progressLogged = 0;
  const startedAt = performance.now();
  const baseTimestamp = Date.now();

  await new Promise((resolve) => {
    let count = 0;
    const ticker = setInterval(() => {
      const burstEnd = Math.min(totalEvents, count + eventsPerTick);
      while (count < burstEnd) {
        const threadId = `thread:stress-${count % THREAD_COUNT}`;
        const item = {
          id: `item:${count}`,
          threadId,
          source: 'cli',
          kind: 'command',
          title: `evt-${count}`,
          content: `payload-${count} `.repeat(8),
          timestamp: baseTimestamp + count,
        };
        const t0 = performance.now();
        const ok = manager.appendItem(item);
        const dt = performance.now() - t0;
        latencies[count] = dt;
        if (ok) appended += 1; else skipped += 1;
        count += 1;
      }

      if (count >= totalEvents) {
        clearInterval(ticker);
        resolve();
        return;
      }

      const elapsedSec = (performance.now() - startedAt) / 1000;
      if (elapsedSec - progressLogged >= 30) {
        progressLogged = Math.floor(elapsedSec / 30) * 30;
        const memNow = process.memoryUsage();
        console.log(
          `[stress] +${progressLogged}s events=${count}/${totalEvents} rss=${formatMb(memNow.rss)} heap=${formatMb(memNow.heapUsed)} writes=${diskWrites}`,
        );
      }
    }, tickMs);
    // Intentionally NOT unref'd — ticker is the primary driver of this script.
  });

  // Flush any pending debounced write so the final count reflects shutdown.
  await manager.flushSnapshot();
  // Let the disk poller catch the final write.
  await new Promise((r) => setTimeout(r, 200));

  clearInterval(memInterval);
  clearInterval(diskInterval);

  const elapsedMs = performance.now() - startedAt;
  const final = process.memoryUsage();

  // Latency stats.
  const used = latencies.slice(0, appended + skipped);
  const sorted = Float64Array.from(used).sort();
  const avg = used.reduce((a, b) => a + b, 0) / used.length;
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  const maxLat = sorted[sorted.length - 1];

  const rssGrowthMb = (peakRss - baseline.rss) / 1024 / 1024;
  const writeRatio = diskWrites / (appended + skipped || 1);

  const report = {
    config: { durationSec: DURATION_SEC, rate: RATE, threads: THREAD_COUNT, debounceMs: SNAPSHOT_DEBOUNCE_MS },
    events: { total: appended + skipped, appended, skipped },
    elapsedSec: elapsedMs / 1000,
    latencyMs: { avg, p50, p95, p99, max: maxLat },
    memory: {
      baselineRssMb: baseline.rss / 1024 / 1024,
      peakRssMb: peakRss / 1024 / 1024,
      finalRssMb: final.rss / 1024 / 1024,
      rssGrowthMb,
      peakHeapMb: peakHeap / 1024 / 1024,
      finalHeapMb: final.heapUsed / 1024 / 1024,
    },
    disk: { writes: diskWrites, writeRatio },
    snapshotFileBytes: existsSync(snapshotPath) ? statSync(snapshotPath).size : 0,
  };

  console.log('');
  console.log('[stress] ===== report =====');
  console.log(`events     : ${report.events.appended} appended, ${report.events.skipped} dedup-skipped`);
  console.log(`elapsed    : ${report.elapsedSec.toFixed(1)}s`);
  console.log(`latency    : avg=${formatMs(avg)} p50=${formatMs(p50)} p95=${formatMs(p95)} p99=${formatMs(p99)} max=${formatMs(maxLat)}`);
  console.log(`memory     : baseline=${formatMb(baseline.rss)} peak=${formatMb(peakRss)} final=${formatMb(final.rss)} growth=${rssGrowthMb.toFixed(1)}MB`);
  console.log(`heap       : peak=${formatMb(peakHeap)} final=${formatMb(final.heapUsed)}`);
  console.log(`disk       : ${diskWrites} snapshot writes (ratio ${writeRatio.toFixed(4)} writes/event)`);
  console.log(`snapshot   : ${report.snapshotFileBytes} bytes on disk`);

  // Acceptance checks.
  const failures = [];
  if (rssGrowthMb > MAX_RSS_GROWTH_MB) {
    failures.push(`RSS growth ${rssGrowthMb.toFixed(1)}MB exceeds ${MAX_RSS_GROWTH_MB}MB`);
  }
  if (maxLat > MAX_APPEND_LATENCY_MS) {
    failures.push(`max appendItem latency ${formatMs(maxLat)} exceeds ${MAX_APPEND_LATENCY_MS}ms`);
  }
  if (writeRatio > MAX_WRITE_RATIO) {
    failures.push(`disk write ratio ${writeRatio.toFixed(4)} exceeds ${MAX_WRITE_RATIO} (debounce ineffective)`);
  }

  // Clean up the temp directory unless the user asked to keep it.
  if (!args['keep-snapshot']) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    console.log(`[stress] retained snapshot dir: ${dir}`);
  }

  if (failures.length > 0) {
    console.log('');
    console.log('[stress] FAIL');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('[stress] PASS — debounce + caps held under load');
}

main().catch((err) => {
  console.error('[stress] crashed:', err);
  process.exitCode = 2;
});
