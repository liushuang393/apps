/**
 * mint_e2e_token 束読み 8 app の shim が共通 module を解決でき、
 * spec が使う symbol と suite deployment 分岐を保っていることを確認する。
 *
 * suite 分岐は app ごとに env 変数も fail 方針も違うので共通化していない。
 * ここでは「移行で分岐が消えていない」ことを固定する。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import * as aiEvaluation from '../../tests/apps/governance_risk_platform/modules/ai_evaluation/e2e/helpers/auth';
import * as aiMaintenance from '../../tests/apps/legacy_modernization_platform/modules/ai_maintenance/e2e/helpers/auth';
import * as assessment from '../../tests/apps/legacy_modernization_platform/modules/assessment/e2e/helpers/auth';
import * as benchmark from '../../tests/apps/legacy_modernization_platform/modules/benchmark/e2e/helpers/auth';
import * as cloudOptimization from '../../tests/apps/legacy_modernization_platform/modules/cloud_optimization/e2e/helpers/auth';
import * as javaDb from '../../tests/apps/legacy_modernization_platform/modules/java_db_modernization/e2e/helpers/auth';
import * as modernizationCore from '../../tests/apps/legacy_modernization_platform/modules/modernization_analysis_core/e2e/helpers/auth';
import * as testGeneration from '../../tests/apps/legacy_modernization_platform/modules/test_generation/e2e/helpers/auth';

const REPO = resolve(__dirname, '..', '..');

const WITH_TENANT = {
  ai_maintenance: aiMaintenance,
  assessment,
  benchmark,
  cloud_optimization: cloudOptimization,
  java_db_modernization: javaDb,
  modernization_analysis_core: modernizationCore,
};

const AUTH_ONLY = { ai_evaluation: aiEvaluation, test_generation: testGeneration };

test('8 本すべてが authHeaders を export する', () => {
  for (const [name, mod] of Object.entries({ ...WITH_TENANT, ...AUTH_ONLY })) {
    expect(typeof mod.authHeaders, name).toBe('function');
  }
});

test('tenantHeaders を持っていた 6 本は今も持っている', () => {
  for (const [name, mod] of Object.entries(WITH_TENANT)) {
    expect(typeof mod.tenantHeaders, name).toBe('function');
  }
});

test('tokens.json 未発行なら authHeaders は空（統合前と同じ no-auth 扱い）', () => {
  // このプロセスの cwd は repo root なので .auth/tokens.json は存在しない。
  for (const [name, mod] of Object.entries(AUTH_ONLY)) {
    if (name === 'test_generation') {
      continue; // suite 分岐は env 依存なので下の専用テストで見る
    }
    expect(mod.authHeaders('admin'), name).toEqual({});
  }
});

test('suite deployment 分岐が移行で消えていない', () => {
  const cases: [string, string][] = [
    ['ai_maintenance', 'isSuiteDeployment'],
    ['java_db_modernization', 'isSuiteDeployment'],
    ['modernization_analysis_core', 'isSuiteDeployment'],
    ['test_generation', 'isSuiteDeployment'],
    ['assessment', 'isSuiteApiKeyMode'],
    ['benchmark', 'isSuiteApiKeyMode'],
    ['cloud_optimization', 'isSuiteApiKeyMode'],
  ];
  for (const [name, guard] of cases) {
    const body = readFileSync(
      resolve(REPO, `tests/apps/legacy_modernization_platform/modules/${name}/e2e/helpers/auth.ts`),
      'utf8',
    );
    expect(body, name).toContain(`${guard}()`);
  }
});

test('LEGACY_MODERNIZATION_PLATFORM_API_KEY 未設定時の fail-loud が 4 本に残っている', () => {
  for (const name of [
    'ai_maintenance',
    'java_db_modernization',
    'modernization_analysis_core',
    'test_generation',
  ]) {
    const body = readFileSync(
      resolve(REPO, `tests/apps/legacy_modernization_platform/modules/${name}/e2e/helpers/auth.ts`),
      'utf8',
    );
    expect(body, name).toContain('LEGACY_MODERNIZATION_PLATFORM_API_KEY 未設定');
    expect(body, name).toContain('throw new Error');
  }
});

test('suite API key mode の非 admin sentinel が 3 本に残っている', () => {
  for (const name of ['assessment', 'benchmark', 'cloud_optimization']) {
    const body = readFileSync(
      resolve(REPO, `tests/apps/legacy_modernization_platform/modules/${name}/e2e/helpers/auth.ts`),
      'utf8',
    );
    expect(body, name).toContain('__invalid_e2e_api_key__');
  }
});

test('mint を使う 4 本だけが appConfigPath を渡している', () => {
  const minting = ['ai_maintenance', 'java_db_modernization', 'modernization_analysis_core', 'assessment'];
  const notMinting = ['benchmark', 'cloud_optimization', 'test_generation'];
  for (const name of minting) {
    const body = readFileSync(
      resolve(REPO, `tests/apps/legacy_modernization_platform/modules/${name}/e2e/helpers/auth.ts`),
      'utf8',
    );
    expect(body, name).toContain('appConfigPath');
    expect(body, name).toContain(`modules/${name}/app_config.json`);
  }
  for (const name of notMinting) {
    const body = readFileSync(
      resolve(REPO, `tests/apps/legacy_modernization_platform/modules/${name}/e2e/helpers/auth.ts`),
      'utf8',
    );
    expect(body, name).not.toContain('appConfigPath');
  }
});

test('tenant 既定値 e2e-tenant を持っていた 2 本は維持している', () => {
  for (const mod of [benchmark, cloudOptimization]) {
    expect(mod.tenantHeaders()).toHaveProperty('x-tenant-id', 'e2e-tenant');
  }
});
