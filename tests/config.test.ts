import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// We test the config module logic by reimplementing with custom paths
// to avoid touching the real ~/.agent-memory/config.json

interface AgentMemoryConfig {
  dbPath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  autoEmbed: boolean;
  logLevel: 'quiet' | 'normal' | 'verbose';
}

function makeTestDir(): string {
  const dir = join(tmpdir(), `cam-config-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Config', () => {
  let testDir: string;
  let configPath: string;

  const DEFAULT_CONFIG: AgentMemoryConfig = {
    dbPath: 'default.db',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    embeddingDimensions: 384,
    autoEmbed: true,
    logLevel: 'normal',
  };

  function loadConfig(): AgentMemoryConfig {
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      delete raw.__proto__;
      delete raw.constructor;
      delete raw.prototype;
      return { ...DEFAULT_CONFIG, ...raw };
    }
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig(config: Partial<AgentMemoryConfig>): void {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true, mode: 0o700 });
    const current = loadConfig();
    const merged = { ...current, ...config };
    writeFileSync(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  }

  beforeEach(() => {
    testDir = makeTestDir();
    configPath = join(testDir, 'config.json');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('loads config from file', () => {
    writeFileSync(configPath, JSON.stringify({ logLevel: 'verbose' }));
    const config = loadConfig();
    expect(config.logLevel).toBe('verbose');
    expect(config.embeddingModel).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('merges partial config with defaults', () => {
    writeFileSync(configPath, JSON.stringify({ autoEmbed: false }));
    const config = loadConfig();
    expect(config.autoEmbed).toBe(false);
    expect(config.embeddingDimensions).toBe(384);
  });

  it('saves config and can reload it', () => {
    saveConfig({ logLevel: 'quiet', autoEmbed: false });
    const config = loadConfig();
    expect(config.logLevel).toBe('quiet');
    expect(config.autoEmbed).toBe(false);
    // Defaults preserved
    expect(config.embeddingDimensions).toBe(384);
  });

  it('overwrites existing values on save', () => {
    saveConfig({ logLevel: 'quiet' });
    saveConfig({ logLevel: 'verbose' });
    const config = loadConfig();
    expect(config.logLevel).toBe('verbose');
  });

  it('creates config file with restricted permissions', () => {
    saveConfig({ logLevel: 'quiet' });
    expect(existsSync(configPath)).toBe(true);
    const { statSync } = require('node:fs');
    const stat = statSync(configPath);
    // Check that file is owner-only (0o600 = 33152 on macOS)
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('creates directory if it does not exist', () => {
    rmSync(testDir, { recursive: true, force: true });
    expect(existsSync(testDir)).toBe(false);
    saveConfig({ logLevel: 'normal' });
    expect(existsSync(testDir)).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it('sanitizes __proto__ to prevent prototype pollution', () => {
    writeFileSync(configPath, '{"__proto__": {"polluted": true}, "logLevel": "quiet"}');
    const config = loadConfig();
    expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
    expect(config.logLevel).toBe('quiet');
  });
});
