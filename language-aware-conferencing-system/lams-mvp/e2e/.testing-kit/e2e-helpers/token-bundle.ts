/**
 * mint_e2e_token 束読み module（contract-auth JWT）
 *
 * global-setup が `testing-kit/scripts/mint_e2e_token.py` で発行した
 * `.auth/tokens.json` を読み、リクエストヘッダへ変換する。
 * tenant_sso で tenant がサーバ採番される app 向けに、実行時 mint も提供する。
 *
 * 本 module は auth-service の実 login（`./auth.ts`）とは別機構。
 * suite deployment 判定（app ごとに env 変数も fail 方針も違う）は各 app の
 * helper 側に残し、ここでは 8 app が同形で複製していた部分だけを引き受ける。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** mint_e2e_token.py が返す 1 トークン。 */
export interface MintedToken {
  header: string;
  value: string;
}

/** execFileSync 相当の差し替え口（単体テスト用）。 */
export type ExecImpl = (file: string, args: readonly string[]) => string;

export interface TokenBundleConfig {
  /** エラーメッセージに出す app 識別子。 */
  app: string;
  /** tokens.json の位置。既定は `<cwd>/.auth/tokens.json`。 */
  tokensPath?: string;
  /** 実行時 mint に渡す app_config.json の絶対パス。mint を使う app のみ必須。 */
  appConfigPath?: string;
  /** mint 実行に使う python。既定は E2E_PYTHON または `python`。 */
  python?: string;
  /** mint 実行の差し替え口（単体テスト用）。 */
  execImpl?: ExecImpl;
}

export interface TokenBundleClient {
  /** 事前発行した固定 role の認証ヘッダ（未発行なら空 = 認証なし扱い）。 */
  authHeaders(role?: string): Record<string, string>;
  /** 指定 tenant のトークンを実行時発行し、x-tenant-id 込みで返す。 */
  mintTenantHeaders(tenantId: string, options?: { role?: string }): Record<string, string>;
}

const MINT_RELATIVE = join('testing-kit', 'scripts', 'mint_e2e_token.py');

/** mint script を持つディレクトリまで遡って repo root を探す。 */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, MINT_RELATIVE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return resolve(start, '..', '..', '..');
}

export function createTokenBundleClient(config: TokenBundleConfig): TokenBundleClient {
  const app = config.app;
  const tokensPath = config.tokensPath ?? join(process.cwd(), '.auth', 'tokens.json');
  const repoRoot = findRepoRoot(process.cwd());
  const mintScript = join(repoRoot, MINT_RELATIVE);
  const exec: ExecImpl =
    config.execImpl ??
    ((file, args) =>
      execFileSync(file, [...args], { cwd: repoRoot, encoding: 'utf-8', env: process.env }));

  /** 読めない・壊れている場合は空扱い（統合前 8 app の共通挙動）。 */
  function loadTokens(): Record<string, MintedToken> {
    try {
      return JSON.parse(readFileSync(tokensPath, 'utf-8')) as Record<string, MintedToken>;
    } catch {
      return {};
    }
  }

  function authHeaders(role = 'admin'): Record<string, string> {
    const token = loadTokens()[role];
    if (!token) {
      return {};
    }
    return { [token.header]: token.value };
  }

  function mintTenantHeaders(
    tenantId: string,
    options: { role?: string } = {},
  ): Record<string, string> {
    if (!config.appConfigPath) {
      throw new Error(
        `[${app}/auth] 実行時 mint には appConfigPath が要る。app_config.json の絶対パスを渡すこと`,
      );
    }
    const python = config.python ?? process.env.E2E_PYTHON ?? 'python';
    const out = exec(python, [
      mintScript,
      '--app-config',
      config.appConfigPath,
      '--role',
      options.role ?? 'admin',
      '--tenant',
      tenantId,
    ]);

    let token: MintedToken;
    try {
      token = JSON.parse(out.trim()) as MintedToken;
    } catch {
      throw new Error(
        `[${app}/auth] mint 出力が JSON ではない tenant=${tenantId} out=${out.trim().slice(0, 200)}`,
      );
    }
    return { [token.header]: token.value, 'x-tenant-id': tenantId };
  }

  return { authHeaders, mintTenantHeaders };
}
