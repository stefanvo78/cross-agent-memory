import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentMemoryConfig {
  dbPath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  autoEmbed: boolean;  // if false, skip embedding (fallback mode)
  logLevel: 'quiet' | 'normal' | 'verbose';
}

const DEFAULT_CONFIG: AgentMemoryConfig = {
  dbPath: join(homedir(), '.agent-memory', 'memory.db'),
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  embeddingDimensions: 384,
  autoEmbed: true,
  logLevel: 'normal',
};

const CONFIG_PATH = join(homedir(), '.agent-memory', 'config.json');

export function loadConfig(): AgentMemoryConfig {
  if (existsSync(CONFIG_PATH)) {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...raw };
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: Partial<AgentMemoryConfig>): void {
  const dir = join(homedir(), '.agent-memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
}
