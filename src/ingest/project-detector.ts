import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectInfo } from '../types.js';

export function detectProject(cwd?: string): ProjectInfo {
  const basePath = cwd ?? process.cwd();
  const rootPath = getGitRoot(basePath) ?? basePath;
  const gitRemote = getGitRemote(rootPath);

  if (gitRemote) {
    const id = normalizeGitRemote(gitRemote);
    const name = id.split('/').pop() ?? path.basename(rootPath);
    return { id, name, gitRemote, rootPath };
  }

  // Fallback: use "local/<dirname>"
  const name = path.basename(rootPath);
  return { id: `local/${name}`, name, rootPath };
}

function getGitRoot(cwd: string): string | null {
  // Fast path: walk up to find .git directory
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  while (dir !== fsRoot) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }

  // Slow path: git CLI
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

function getGitRemote(cwd: string): string | null {
  // Fast path: read .git/config
  try {
    const configPath = path.join(cwd, '.git', 'config');
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, 'utf-8');
    const remoteMatch = content.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
    if (!remoteMatch) return null;
    const urlMatch = remoteMatch[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch ? urlMatch[1].trim() : null;
  } catch {
    return null;
  }
}

export function normalizeGitRemote(remote: string): string {
  let normalized = remote.replace(/\.git$/, '');

  // SSH format: git@github.com:user/repo
  const sshMatch = normalized.match(/^[\w-]+@[\w.-]+:(.+)$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS/SSH URL format
  try {
    const url = new URL(normalized);
    return url.pathname.replace(/^\//, '');
  } catch {
    const segments = normalized.split('/').filter(Boolean);
    return segments.slice(-2).join('/');
  }
}
