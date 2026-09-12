/**
 * Playwright を app の e2e dir / repository root のどちらから起動しても、
 * app.toml と scripts/ の基準 directory を一意に解決する。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function configArgument(): string | undefined {
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === '--config' || argument === '-c') {
      return process.argv[index + 1];
    }
    if (argument.startsWith('--config=')) {
      return argument.slice('--config='.length);
    }
  }
  return undefined;
}

export function resolveAppE2ERoot(): string {
  const explicitE2E = process.env.E2E_ROOT?.trim();
  if (explicitE2E) return path.resolve(explicitE2E);

  // E2E_APP_ROOT is retained as a compatibility fallback.  The portable
  // certification kernel defines it as the application source root, while
  // E2E_ROOT is the authoritative directory containing app.toml and scripts/.
  const explicit = process.env.E2E_APP_ROOT?.trim();
  if (explicit) return path.resolve(explicit);

  const config = configArgument();
  if (config) {
    const resolved = path.resolve(process.cwd(), config);
    const root =
      fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved
        : path.dirname(resolved);
    process.env.E2E_APP_ROOT = root;
    return root;
  }

  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'app.toml'))) {
    process.env.E2E_APP_ROOT = cwd;
    return cwd;
  }

  throw new Error(
    '[testing-kit/app-root] E2E root を解決できません。' +
      'app.toml のある directory から起動するか --config <e2e/playwright.config.ts> / E2E_ROOT を指定してください。',
  );
}
