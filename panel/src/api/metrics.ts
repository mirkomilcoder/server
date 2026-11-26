import { runAction } from './run';

/*
 * Live host metrics from /proc (no extra daemon). CPU % and network speed
 * need two samples, so `ProcSampler` keeps the previous counters.
 */

export interface ProcSample {
  cpuPct: number | null; // null on the very first sample
  cores: number;
  load1: number;
  memTotal: number; // bytes
  memUsed: number;
  swapUsed: number;
  rxBps: number | null; // bits/s
  txBps: number | null;
}

export interface DiskSample {
  size: number;
  used: number;
  avail: number;
}

interface Counters {
  t: number;
  cpuIdle: number;
  cpuTotal: number;
  rx: number;
  tx: number;
}

// Interfaces that would double-count traffic (virtual / container bridges).
const VIRTUAL_IF = /^(lo|docker\d*|br-|veth|virbr|tailscale|vnet|cni|flannel|kube)/;

export function parseProc(text: string): { counters: Omit<Counters, 't'>; cores: number; load1: number; mem: { total: number; used: number; swapUsed: number } } {
  let cpuIdle = 0, cpuTotal = 0, cores = 0, rx = 0, tx = 0, load1 = 0;
  const mem: Record<string, number> = {};

  for (const line of text.split('\n')) {
    if (line.startsWith('cpu ')) {
      const v = line.trim().split(/\s+/).slice(1).map(Number);
      // user nice system idle iowait irq softirq steal (guest is already in user)
      cpuTotal = v.slice(0, 8).reduce((a, b) => a + b, 0);
      cpuIdle = v[3] + (v[4] ?? 0);
    } else if (/^cpu\d+ /.test(line)) {
      cores++;
    } else if (/^[A-Za-z_()]+:\s+\d+ kB$/.test(line)) {
      const [k, v] = line.split(/:\s+/);
      mem[k] = parseInt(v, 10) * 1024;
    } else if (/^\d+\.\d+ \d+\.\d+ \d+\.\d+ /.test(line)) {
      load1 = parseFloat(line);
    } else if (line.includes(':') && /^\s*[\w.@-]+:\s*\d/.test(line)) {
      const [name, rest] = line.split(':');
      if (VIRTUAL_IF.test(name.trim())) continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }
  }

  const total = mem.MemTotal ?? 0;
  return {
    counters: { cpuIdle, cpuTotal, rx, tx },
    cores: cores || 1,
    load1,
    mem: { total, used: total - (mem.MemAvailable ?? 0), swapUsed: (mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0) },
  };
}

export class ProcSampler {
  private prev: Counters | null = null;

  async sample(): Promise<ProcSample> {
    const out = await runAction('metrics.proc', {});
    const p = parseProc(out);
    const now = { ...p.counters, t: performance.now() };
    let cpuPct: number | null = null, rxBps: number | null = null, txBps: number | null = null;

    // Two samples closer than 0.5 s give absurd rates (e.g. React StrictMode
    // double effects): keep the previous counters and report no rate yet.
    if (this.prev && now.t - this.prev.t < 500) {
      return { cpuPct: null, cores: p.cores, load1: p.load1, memTotal: p.mem.total, memUsed: p.mem.used, swapUsed: p.mem.swapUsed, rxBps: null, txBps: null };
    }
    if (this.prev) {
      const dTotal = now.cpuTotal - this.prev.cpuTotal;
      const dIdle = now.cpuIdle - this.prev.cpuIdle;
      if (dTotal > 0) cpuPct = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
      const dt = (now.t - this.prev.t) / 1000;
      if (dt > 0) {
        rxBps = Math.max(0, ((now.rx - this.prev.rx) * 8) / dt);
        txBps = Math.max(0, ((now.tx - this.prev.tx) * 8) / dt);
      }
    }
    this.prev = now;
    return { cpuPct, cores: p.cores, load1: p.load1, memTotal: p.mem.total, memUsed: p.mem.used, swapUsed: p.mem.swapUsed, rxBps, txBps };
  }
}

export async function sampleDisk(): Promise<DiskSample> {
  const out = await runAction('metrics.disk', {});
  const [size, used, avail] = out.trim().split('\n')[1].trim().split(/\s+/).map(Number);
  return { size, used, avail };
}

export interface UnitState {
  id: string;
  load: string;
  active: string;
  sub: string;
}

export async function keyUnitStates(units: string[]): Promise<UnitState[]> {
  const out = await runAction('services.keyStatus', { units });
  return out
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const kv = Object.fromEntries(block.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
      return { id: kv.Id ?? '?', load: kv.LoadState ?? '?', active: kv.ActiveState ?? '?', sub: kv.SubState ?? '?' };
    });
}

export const GB = 1024 ** 3;
