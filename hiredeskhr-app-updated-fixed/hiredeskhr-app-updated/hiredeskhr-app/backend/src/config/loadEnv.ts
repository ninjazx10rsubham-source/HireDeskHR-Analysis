import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Robust .env loader.
 *
 * The old code did `dotenv.config({ path: path.resolve(__dirname, '../.env') })`
 * which resolves to backend/src/.env (ts-node) or backend/dist/.env (built) -
 * neither of those files exist, so the backend silently started with ZERO
 * credentials whenever it was launched from the repository root
 * (e.g. `npm start` -> `node backend/dist/index.js`).
 *
 * This walks up from the compiled/source directory until it finds a .env,
 * and also loads the repo-root .env as a fallback layer.
 */

const loadedFiles: string[] = [];

function tryLoad(file: string) {
  if (!file || loadedFiles.includes(file)) return;
  if (!fs.existsSync(file)) return;
  // No override: whatever is already in process.env wins. That means real shell
  // variables beat .env files, and the first file loaded beats later ones.
  dotenv.config({ path: file });
  loadedFiles.push(file);
}

export function loadEnv(): string[] {
  const candidates: string[] = [];

  // Walk up from this file: src/config -> src -> backend -> repo root
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(dir, '.env'));
    dir = path.dirname(dir);
  }

  // Also consider wherever the process was launched from
  candidates.push(path.resolve(process.cwd(), 'backend', '.env'));
  candidates.push(path.resolve(process.cwd(), '.env'));

  // backend/.env should win over the repo-root .env, so load it first.
  // (dotenv never overwrites an already-set variable, so first load wins.)
  const backendEnvs = candidates.filter((c) => c.endsWith(`${path.sep}backend${path.sep}.env`));
  const otherEnvs = candidates.filter((c) => !backendEnvs.includes(c));

  backendEnvs.forEach(tryLoad);
  otherEnvs.forEach(tryLoad);

  return loadedFiles;
}

export function envFilePath(): string {
  // Canonical file we write credentials back into
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (path.basename(dir) === 'backend') return path.join(dir, '.env');
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), 'backend', '.env');
}

/** Treat "", "   ", "your-key-here", "changeme" etc. as not configured. */
export function cleanSecret(value?: string | null): string {
  const v = (value || '').trim();
  if (!v) return '';
  const placeholders = [
    'your-app-password',
    'your-api-key',
    'your-token',
    'changeme',
    'xxxx',
    'paste-here',
    'todo'
  ];
  if (placeholders.some((p) => v.toLowerCase() === p || v.toLowerCase().includes(p))) return '';
  return v;
}

loadEnv();
