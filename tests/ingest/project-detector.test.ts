import { describe, it, expect } from 'vitest';
import { normalizeGitRemote } from '../../src/ingest/project-detector.js';

describe('normalizeGitRemote()', () => {
  describe('HTTPS URLs', () => {
    it('normalizes standard HTTPS URL', () => {
      expect(normalizeGitRemote('https://github.com/user/repo')).toBe('user/repo');
    });

    it('normalizes HTTPS URL with .git suffix', () => {
      expect(normalizeGitRemote('https://github.com/user/repo.git')).toBe('user/repo');
    });

    it('normalizes GitLab HTTPS URL', () => {
      expect(normalizeGitRemote('https://gitlab.com/org/project')).toBe('org/project');
    });

    it('normalizes HTTPS URL with nested path', () => {
      expect(normalizeGitRemote('https://github.com/org/sub/repo.git')).toBe(
        'org/sub/repo',
      );
    });
  });

  describe('SSH URLs', () => {
    it('normalizes standard SSH URL', () => {
      expect(normalizeGitRemote('git@github.com:user/repo')).toBe('user/repo');
    });

    it('normalizes SSH URL with .git suffix', () => {
      expect(normalizeGitRemote('git@github.com:user/repo.git')).toBe('user/repo');
    });

    it('normalizes GitLab SSH URL', () => {
      expect(normalizeGitRemote('git@gitlab.com:org/project')).toBe('org/project');
    });

    it('normalizes SSH URL with nested path', () => {
      expect(normalizeGitRemote('git@github.com:org/sub/repo.git')).toBe(
        'org/sub/repo',
      );
    });
  });

  describe('.git suffix stripping', () => {
    it('strips .git suffix from any URL format', () => {
      const inputs = [
        'https://github.com/user/repo.git',
        'git@github.com:user/repo.git',
      ];
      for (const input of inputs) {
        const result = normalizeGitRemote(input);
        expect(result).not.toContain('.git');
        expect(result).toBe('user/repo');
      }
    });

    it('does not strip .git from middle of path', () => {
      // Edge case: ".git" in directory name should not be stripped
      const result = normalizeGitRemote('https://github.com/user/.github');
      expect(result).toBe('user/.github');
    });
  });
});
