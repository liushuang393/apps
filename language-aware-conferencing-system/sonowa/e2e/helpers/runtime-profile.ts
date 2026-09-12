/**
 * kit-managed: app.toml [deployment] の唯一の TypeScript resolver。
 *
 * 契約未宣言の既存 app は caller が渡す legacyStartServer をそのまま使う。
 * 契約宣言後は selector env > default_mode で profile を選び、未知 mode、
 * 不完全 profile、required env 欠落を Playwright 起動前に fail-closed にする。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppE2ERoot } from './app-root';

export interface RuntimeProfile {
  mode: string;
  startServer: boolean;
  runGlobalSetup: boolean;
  requiredEnv: string[];
  env: Record<string, string>;
}

interface ResolveOptions {
  legacyStartServer?: boolean;
  legacyRunGlobalSetup?: boolean;
}

interface ParsedProfile {
  startServer?: boolean;
  runGlobalSetup?: boolean;
  requiredEnv?: string[];
  env: Record<string, string>;
}

interface DeploymentContract {
  defaultMode?: string;
  modeEnv?: string;
  profiles: Map<string, ParsedProfile>;
}

function quotedValue(raw: string): string | undefined {
  return raw.match(/^\s*"([^"]*)"\s*(?:#.*)?$/)?.[1];
}

function booleanValue(raw: string): boolean | undefined {
  const value = raw.replace(/\s+#.*$/, '').trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function stringArrayValue(raw: string): string[] | undefined {
  const value = raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/,\s*]$/, ']');
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function readDeploymentContract(): DeploymentContract | undefined {
  const tomlPath = path.join(resolveAppE2ERoot(), 'app.toml');
  if (!fs.existsSync(tomlPath)) return undefined;

  const contract: DeploymentContract = { profiles: new Map() };
  let sawDeployment = false;
  let section = '';
  for (const rawLine of fs.readFileSync(tomlPath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section === 'deployment' || section.startsWith('deployment.modes.')) {
        sawDeployment = true;
      }
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    if (section === 'deployment') {
      if (key === 'default_mode') contract.defaultMode = quotedValue(rawValue);
      if (key === 'mode_env') contract.modeEnv = quotedValue(rawValue);
      continue;
    }
    const prefix = 'deployment.modes.';
    if (!section.startsWith(prefix)) continue;
    const suffix = section.slice(prefix.length);
    const isEnvSection = suffix.endsWith('.env');
    const mode = isEnvSection ? suffix.slice(0, -4) : suffix;
    const profile = contract.profiles.get(mode) ?? { env: {} };
    if (isEnvSection) {
      const value = quotedValue(rawValue);
      if (value !== undefined) profile.env[key] = value;
      contract.profiles.set(mode, profile);
      continue;
    }
    if (key === 'start_server') profile.startServer = booleanValue(rawValue);
    if (key === 'run_global_setup') profile.runGlobalSetup = booleanValue(rawValue);
    if (key === 'required_env') profile.requiredEnv = stringArrayValue(rawValue);
    contract.profiles.set(mode, profile);
  }
  return sawDeployment ? contract : undefined;
}

export function resolveRuntimeProfile(options: ResolveOptions = {}): RuntimeProfile {
  const contract = readDeploymentContract();
  if (!contract) {
    return {
      mode: 'legacy',
      startServer: options.legacyStartServer ?? false,
      runGlobalSetup: options.legacyRunGlobalSetup ?? true,
      requiredEnv: [],
      env: {},
    };
  }
  if (!contract.defaultMode || !contract.modeEnv || contract.profiles.size === 0) {
    throw new Error('[testing-kit/runtime-profile] incomplete [deployment] contract in app.toml');
  }
  const mode = process.env[contract.modeEnv]?.trim() || contract.defaultMode;
  const selected = contract.profiles.get(mode);
  if (!selected) {
    throw new Error(
      `[testing-kit/runtime-profile] unknown mode ${mode}; expected one of ` +
        [...contract.profiles.keys()].sort().join(', '),
    );
  }
  if (
    typeof selected.startServer !== 'boolean' ||
    typeof selected.runGlobalSetup !== 'boolean' ||
    !selected.requiredEnv
  ) {
    throw new Error(`[testing-kit/runtime-profile] incomplete profile: ${mode}`);
  }
  const missing = selected.requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `[testing-kit/runtime-profile] mode ${mode} requires env: ${missing.join(', ')}`,
    );
  }
  for (const [name, value] of Object.entries(selected.env)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !value.trim()) {
      throw new Error(`[testing-kit/runtime-profile] invalid env entry in mode ${mode}: ${name}`);
    }
    if (/(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE|CREDENTIAL|PASSWD)/i.test(name)) {
      throw new Error(`[testing-kit/runtime-profile] secret env must use required_env: ${name}`);
    }
    if (!process.env[name]?.trim()) process.env[name] = value;
  }
  return {
    mode,
    startServer: process.env.E2E_NO_SERVER === '1' ? false : selected.startServer,
    runGlobalSetup: selected.runGlobalSetup,
    requiredEnv: selected.requiredEnv,
    env: selected.env,
  };
}
