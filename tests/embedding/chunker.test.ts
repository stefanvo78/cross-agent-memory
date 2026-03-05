import { describe, it, expect } from 'vitest';
import { chunkText } from '../../src/embedding/chunker.js';

describe('chunkText()', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns short text as a single chunk', () => {
    const text = 'This is a short text.';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('returns text exactly at max size as a single chunk', () => {
    // Default maxTokens=500, 4 chars/token → 2000 chars
    const text = 'A'.repeat(2000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
  });

  it('splits long text into multiple chunks', () => {
    // Generate text well beyond 2000 chars (default maxChars)
    const text = 'This is a sentence. '.repeat(200); // ~4000 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('chunks have overlap', () => {
    // Build text with sentence-like boundaries
    const sentences = Array.from({ length: 100 }, (_, i) => `Sentence number ${i}. `);
    const text = sentences.join('');
    const chunks = chunkText(text);

    if (chunks.length >= 2) {
      // The end of chunk N should overlap with the start of chunk N+1
      const endOfFirst = chunks[0].slice(-100);
      const startOfSecond = chunks[1].slice(0, 200);
      // Some text from the end of chunk 0 should appear in chunk 1
      const overlapFound = endOfFirst
        .split(' ')
        .filter(Boolean)
        .some((word) => startOfSecond.includes(word));
      expect(overlapFound).toBe(true);
    }
  });

  it('breaks at paragraph boundaries when possible', () => {
    // Create text with a clear paragraph boundary in the second half of maxChars
    const part1 = 'A'.repeat(1200); // > 50% of 2000
    const part2 = 'B'.repeat(1200);
    const text = `${part1}\n\n${part2}`;
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end near the paragraph boundary
    expect(chunks[0].endsWith('A')).toBe(true);
  });

  it('breaks at sentence boundaries when no paragraph boundary', () => {
    // No paragraph breaks, but has sentence breaks
    const part1 = 'A'.repeat(1200);
    const text = `${part1}. ${'B'.repeat(1200)}`;
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('all chunks are non-empty trimmed strings', () => {
    const text = 'Word '.repeat(1000);
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk).toBe(chunk.trim());
    }
  });

  it('respects custom maxTokens parameter', () => {
    const text = 'Hello world. '.repeat(100); // ~1300 chars
    // maxTokens=100, overlapTokens=10 → maxChars=400
    const chunks = chunkText(text, 100, 10);
    expect(chunks.length).toBeGreaterThan(2);
  });
});
