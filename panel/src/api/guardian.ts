import { cockpit } from './cockpit';
import type { CockpitHttpClient, CockpitHttpError } from './cockpit-types';

/*
 * Client for the Guardian agent's local API (/run/mirkomil/api.sock).
 * cockpit.http connects through Cockpit's bridge, which runs as the logged-in
 * user — Guardian identifies that user from the socket (SO_PEERCRED) and
 * enforces roles itself, so the UI can't escalate by calling it directly.
 */

const SOCKET = '/run/mirkomil/api.sock';

export type Severity = 'ok' | 'info' | 'warn' | 'crit';

export interface Check {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface GuardianStatus {
  hostname: string;
  time: number;
  uptime: number;
  score: number;
  status: Severity;
  checks: Check[];
  metrics: Record<string, number | null>;
  telegram: boolean;
}

export interface GuardianEvent {
  id: number;
  ts: number;
  kind: 'problem' | 'recovered' | 'action' | 'info';
  severity: Severity;
  title: string;
  detail: string;
  actor: string;
}

export interface Me {
  user: string;
  role: 'admin' | 'developer' | 'viewer' | 'none';
  groups: string[];
}

export type Range = '1h' | '24h' | '7d';

let client: CockpitHttpClient | null = null;
const http = () => (client ??= cockpit().http(SOCKET));

/** Thrown when the agent isn't installed / not running (graceful fallback in the UI). */
export class GuardianUnavailable extends Error {}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  try {
    return JSON.parse(await http().get(path, params)) as T;
  } catch (e) {
    const err = e as CockpitHttpError;
    // no socket → bridge reports not-found / disconnected
    if (!err.status) throw new GuardianUnavailable(err.message ?? 'guardian unavailable');
    throw new Error(`${err.status} ${err.reason ?? ''} ${err.message ?? ''}`.trim());
  }
}

export const guardian = {
  me: () => get<Me>('/v1/me'),
  status: () => get<GuardianStatus>('/v1/status'),
  history: (range: Range, metrics: string[]) =>
    get<{ range: Range; series: Record<string, [number, number][]> }>('/v1/history', { range, metrics: metrics.join(',') }),
  events: (limit = 100) => get<{ events: GuardianEvent[] }>('/v1/events', { limit: String(limit) }),
};
