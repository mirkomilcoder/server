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
  mode?: 'dryrun' | 'auto';
  ip?: string | null;
  tailscale_ip?: string | null;
  os?: string;
  brand?: string;
  domain?: string;
}

export interface GuardianEvent {
  id: number;
  ts: number;
  check_id?: string | null;
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

export interface RuleInfo {
  id: string;
  title: string;
  enabled: boolean;
  risky: boolean;
  cooldown_s: number;
  max_attempts: number;
  last_action: number;
  attempts: number;
}

export interface RulesState {
  mode: 'dryrun' | 'auto';
  rules: RuleInfo[];
}

let client: CockpitHttpClient | null = null;
const http = () => (client ??= cockpit().http(SOCKET));

/** Thrown when the agent isn't installed / not running (graceful fallback in the UI). */
export class GuardianUnavailable extends Error {}

/*
 * cockpit.http rejects with (error, responseBody): the body carries Guardian's
 * readable message ({"error": "…"}), so we keep it instead of "400 Bad Request".
 */
function request<T>(fn: () => Promise<string>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onError = (err: CockpitHttpError, body?: string) => {
      // no socket → the bridge reports not-found / disconnected (agent not installed)
      if (!err?.status) return reject(new GuardianUnavailable(err?.message ?? 'guardian unavailable'));
      let msg = '';
      try {
        msg = (JSON.parse(body ?? '') as { error?: string }).error ?? '';
      } catch {
        /* not JSON */
      }
      reject(new Error(msg || `${err.status} ${err.reason ?? ''}`.trim()));
    };
    fn().then(
      (body) => {
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(e);
        }
      },
      onError as (reason: unknown) => void,
    );
  });
}

const get = <T,>(path: string, params?: Record<string, string>) => request<T>(() => http().get(path, params));
const post = <T,>(path: string, body: object) =>
  request<T>(() => http().post(path, JSON.stringify(body), { 'Content-Type': 'application/json' }));

// ---------------------------------------------------------------- apps (PaaS)

export type AppType = 'dockerfile' | 'django' | 'fastapi' | 'flask' | 'bot' | 'node' | 'static';

export interface DeployStatus {
  id: string;
  app: string;
  by: string;
  state: 'running' | 'success' | 'failed';
  step: string;
  started: number;
  finished?: number;
  type?: AppType;
  web?: boolean;
  port?: number;
  commit?: string;
  image?: string;
  error?: string;
  url?: string;
  /** what the code showed: does it serve HTTP? (null = can't tell) and why */
  site_auto?: boolean | null;
  site_reason?: string;
}

export interface AppInfo {
  name: string;
  repo: string;
  branch: string;
  type: AppType | null;
  port: number;
  mem_mb: number;
  cpus: number;
  autodeploy?: number;
  root_dir?: string;
  /** Published as a site: null = default for the type, 1 = yes, 0 = no. */
  public?: number | null;
  /** required = web framework (always a site) · optional = bot/worker/other · auto = type unknown yet */
  site_mode?: 'required' | 'optional' | 'auto';
  created_by: string;
  created_at: number;
  current: { deploy_id?: string; container?: string; web?: boolean; type?: AppType; port?: number };
  last_deploy: DeployStatus | null;
  url: string | null;
  stats: { cpu: string; mem: string; memPerc: string } | null;
}

export interface AppDetail extends Omit<AppInfo, 'last_deploy' | 'stats'> {
  deploys: DeployStatus[];
  env: { key: string; length: number }[];
}

export interface NewApp {
  name: string;
  repo: string;
  branch: string;
  type: AppType | null;
  port: number;
  mem_mb: number;
  cpus: number;
  env: Record<string, string>;
  /** null = default for the detected type (web frameworks: yes, bots: no). */
  public?: boolean | null;
  /** project folder inside the repo ("" = root, or found automatically) */
  root_dir?: string;
}

export interface WebhookInfo {
  enabled: boolean;
  /** https://hooks.<domain>/github/<app>; null until a domain is connected */
  url: string | null;
  deliveries: { ts: number; event: string; result: 'deployed' | 'queued' | 'ignored' | 'rejected' | 'failed' | 'ok'; detail: string }[];
  pending: { sha: string; who: string; ts: number } | null;
  /** only right after enabling / rotating */
  secret?: string;
}

export interface DockerContainer {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  Ports: string;
  Labels: string;
}

export const apps = {
  list: () => get<{ apps: AppInfo[]; domain: string }>('/v1/apps'),
  create: (a: NewApp) => post<{ deploy_id: string }>('/v1/apps', a),
  detail: (name: string) => get<AppDetail>(`/v1/apps/${encodeURIComponent(name)}`),
  deploy: (name: string) => post<{ deploy_id: string }>(`/v1/apps/${encodeURIComponent(name)}/deploy`, {}),
  rollback: (name: string, deploy_id: string) => post<{ deploy_id: string }>(`/v1/apps/${encodeURIComponent(name)}/rollback`, { deploy_id }),
  deployLog: (name: string, id: string, offset: number) =>
    get<{ status: DeployStatus; text: string; next: number }>(`/v1/apps/${encodeURIComponent(name)}/deploys/${id}`, { offset: String(offset) }),
  control: (name: string, op: 'start' | 'stop' | 'restart') => post<{ result: string }>(`/v1/apps/${encodeURIComponent(name)}/control`, { op }),
  logs: (name: string, lines = 300) => get<{ text: string }>(`/v1/apps/${encodeURIComponent(name)}/logs`, { lines: String(lines) }),
  setEnv: (name: string, env: Record<string, string>, keep: string[]) =>
    post<{ env: { key: string; length: number }[] }>(`/v1/apps/${encodeURIComponent(name)}/env`, { env, keep }),
  settings: (name: string, s: Partial<Pick<NewApp, 'branch' | 'type' | 'port' | 'mem_mb' | 'cpus' | 'root_dir'>>) =>
    post<AppInfo>(`/v1/apps/${encodeURIComponent(name)}/settings`, s),
  remove: (name: string, confirm: string) => post<{ deleted: string }>(`/v1/apps/${encodeURIComponent(name)}/delete`, { confirm }),
  deployKey: (name: string) => post<{ public_key: string }>(`/v1/apps/${encodeURIComponent(name)}/deploykey`, {}),
  setAutodeploy: (name: string, on: boolean) => post<AppInfo>(`/v1/apps/${encodeURIComponent(name)}/settings`, { autodeploy: on }),
  webhook: (name: string) => get<WebhookInfo>(`/v1/apps/${encodeURIComponent(name)}/webhook`),
  setWebhook: (name: string, b: { enabled?: boolean; rotate?: boolean }) => post<WebhookInfo>(`/v1/apps/${encodeURIComponent(name)}/webhook`, b),
  webhookReveal: (name: string) => post<{ secret: string }>(`/v1/apps/${encodeURIComponent(name)}/webhook/reveal`, {}),
  /** Current env values (developers with access to the app; logged in the activity feed). */
  revealEnv: (name: string) => post<{ env: { key: string; value: string }[] }>(`/v1/apps/${encodeURIComponent(name)}/env/reveal`, {}),
  setPublic: (name: string, on: boolean | null) => post<AppInfo>(`/v1/apps/${encodeURIComponent(name)}/settings`, { public: on }),
};

// ---------------------------------------------------------------- users (admin)

export type Role = 'admin' | 'developer' | 'viewer';

export interface PanelUser {
  user: string;
  uid: number;
  name: string;
  role: Role | 'none';
  /** member of sudo: the server owner, never changed from the panel */
  owner: boolean;
  managed: boolean;
  locked: boolean;
  must_change: boolean;
  groups: string[];
  email: string | null;
  invited_by: string | null;
  invited_at: number | null;
  apps: string[];
}

export interface Invite {
  user: string;
  role: Role;
  password: string;
  panel_url: string;
  email?: string | null;
  apps?: string[];
  access?: string;
}

const u = (name: string, tail: string) => `/v1/users/${encodeURIComponent(name)}/${tail}`;

export const users = {
  list: () => get<{ users: PanelUser[] }>('/v1/users'),
  groups: () => get<{ groups: { name: string; about: string }[] }>('/v1/users/groups'),
  create: (b: { user: string; role: Role; name: string; email: string; apps: string[] }) => post<Invite>('/v1/users', b),
  setRole: (name: string, role: Role) => post<{ role: Role }>(u(name, 'role'), { role }),
  setEmail: (name: string, email: string) => post<{ email: string | null; access: string }>(u(name, 'email'), { email }),
  setLocked: (name: string, locked: boolean) => post<{ locked: boolean }>(u(name, 'lock'), { locked }),
  resetPassword: (name: string) => post<Invite>(u(name, 'password'), {}),
  setApps: (name: string, list: string[]) => post<{ apps: string[] }>(u(name, 'apps'), { apps: list }),
  setGroups: (name: string, list: string[]) => post<{ groups: string[] }>(u(name, 'groups'), { groups: list }),
  remove: (name: string) => post<{ deleted: string }>(u(name, 'delete'), { confirm: name }),
};

export interface DatabaseInfo {
  name: string;
  kind: 'postgres' | 'redis';
  image: string;
  mem_mb: number;
  created_by: string;
  created_at: number;
  attached: string[];
  state: string;
  host: string;
  port: number;
}

export const databases = {
  list: () => get<{ databases: DatabaseInfo[] }>('/v1/databases'),
  create: (name: string, kind: DatabaseInfo['kind'], mem_mb: number) => post<DatabaseInfo>('/v1/databases', { name, kind, mem_mb }),
  attach: (name: string, app: string) => post<{ app: string; var: string }>(`/v1/databases/${encodeURIComponent(name)}/attach`, { app }),
  remove: (name: string, confirm: string, drop_data: boolean) =>
    post<{ result: string }>(`/v1/databases/${encodeURIComponent(name)}/delete`, { confirm, drop_data }),
};

export interface TunnelStatus {
  configured: boolean;
  domain?: string;
  panel_host?: string;
  hosts?: string[];
  emails?: string[];
  root_app?: string | null;
  team?: string;
  /** Cloudflare's view: healthy | degraded | down | inactive | unknown */
  status?: string;
  connections?: number;
  /** systemd unit state of cloudflared */
  service?: string;
  error?: string;
  /** "everyone": any email gets a login code, then the server login decides; "emails": only the list */
  access_mode?: AccessMode;
  warnings?: string[];
  /** the owner's own emails (the rest of the list comes from the Users page) */
  owner_emails?: string[] | null;
}

export type AccessMode = 'everyone' | 'emails';

export interface TunnelSync {
  configured: boolean;
  hosts?: string[];
  dns?: { created: string[]; skipped: string[]; removed: string[] };
  warnings?: string[];
}

export const tunnel = {
  status: () => get<TunnelStatus>('/v1/tunnel'),
  /** token may be empty to reuse the stored one (changing emails / root app). */
  setup: (token: string, emails: string[], root_app: string | null, access_mode: AccessMode) =>
    post<TunnelSync>('/v1/tunnel/setup', { token, emails, root_app, access_mode }),
  sync: () => post<TunnelSync>('/v1/tunnel/sync', {}),
};

export const docker = {
  containers: () => get<{ containers: DockerContainer[]; stats: Record<string, { cpu: string; mem: string; memPerc: string }> }>('/v1/docker/containers'),
  op: (name: string, op: 'start' | 'stop' | 'restart') => post<{ result: string }>('/v1/docker/container', { name, op }),
  logs: (name: string, lines = 300) => get<{ text: string }>('/v1/docker/logs', { name, lines: String(lines) }),
  prune: () => post<{ result: string }>('/v1/docker/prune', {}),
};

export const guardian = {
  me: () => get<Me>('/v1/me'),
  status: () => get<GuardianStatus>('/v1/status'),
  history: (range: Range, metrics: string[]) =>
    get<{ range: Range; series: Record<string, [number, number][]> }>('/v1/history', { range, metrics: metrics.join(',') }),
  events: (limit = 100) => get<{ events: GuardianEvent[] }>('/v1/events', { limit: String(limit) }),
  rules: () => get<RulesState>('/v1/rules'),
  setIdentity: (brand: string, domain: string) => post<{ brand: string; domain: string }>('/v1/identity', { brand, domain }),
  setMode: (mode: RulesState['mode']) => post<RulesState>('/v1/rules', { mode }),
  setRule: (rule: string, enabled: boolean) => post<RulesState>('/v1/rules', { rule, enabled }),
};
