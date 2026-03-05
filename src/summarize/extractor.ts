/**
 * Heuristic-based session extractor — no LLM API calls.
 * Parses raw session transcripts and extracts structured information.
 */

export interface ExtractedSession {
  title: string;
  objective: string;
  approach: string;
  filesCreated: string[];
  filesModified: string[];
  decisions: string[];
  errors: string[];
  outcome: string;
  nextSteps: string[];
}

// Matches paths like src/..., ./..., tests/..., lib/..., etc.
const FILE_PATH_RE =
  /(?:^|\s|['"`])((?:\.\/|src\/|tests\/|test\/|lib\/|dist\/|docs\/|config\/|scripts\/|\.github\/)[^\s'"`,;)}\]]+)/gm;

const APPROACH_RE =
  /(?:^|\n)\s*(?:I'll|I will|Let me|First I'll|My approach|I'm going to|The approach|I plan to|Let's)\s+(.+)/gi;

const DECISION_RE =
  /(?:^|\n)\s*(?:I\s+)?(?:decided to|going with|chose|opted for|we decided|choosing|picked)\s+(.+)/gi;

const NEXT_STEP_HEADERS_RE =
  /(?:^|\n)\s*(?:next steps?|remaining|TODO|still need to|what's left|followup|follow-up)/i;

const ERROR_RE = /(?:error|failed|failure|exception|cannot|could not|unable to|crash|bug|broken)/i;

export class SessionExtractor {
  extract(rawText: string): ExtractedSession {
    const lines = rawText.split('\n');
    const { humanMessages, assistantMessages } = this.splitMessages(lines);

    return {
      title: this.extractTitle(humanMessages),
      objective: this.extractObjective(humanMessages),
      approach: this.extractApproach(assistantMessages),
      filesCreated: this.extractFilesCreated(assistantMessages),
      filesModified: this.extractFilesModified(assistantMessages),
      decisions: this.extractDecisions(assistantMessages),
      errors: this.extractErrors(assistantMessages),
      outcome: this.extractOutcome(assistantMessages),
      nextSteps: this.extractNextSteps(assistantMessages),
    };
  }

  /** Split raw transcript into human and assistant message blocks */
  private splitMessages(lines: string[]): {
    humanMessages: string[];
    assistantMessages: string[];
  } {
    const humanMessages: string[] = [];
    const assistantMessages: string[] = [];

    let currentRole: 'human' | 'assistant' | null = null;
    let currentBlock: string[] = [];

    for (const line of lines) {
      if (line.startsWith('Human: ')) {
        if (currentRole && currentBlock.length > 0) {
          const text = currentBlock.join('\n');
          if (currentRole === 'human') humanMessages.push(text);
          else assistantMessages.push(text);
        }
        currentRole = 'human';
        currentBlock = [line.slice('Human: '.length)];
      } else if (line.startsWith('Assistant: ')) {
        if (currentRole && currentBlock.length > 0) {
          const text = currentBlock.join('\n');
          if (currentRole === 'human') humanMessages.push(text);
          else assistantMessages.push(text);
        }
        currentRole = 'assistant';
        currentBlock = [line.slice('Assistant: '.length)];
      } else if (currentRole) {
        currentBlock.push(line);
      }
    }

    // Flush last block
    if (currentRole && currentBlock.length > 0) {
      const text = currentBlock.join('\n');
      if (currentRole === 'human') humanMessages.push(text);
      else assistantMessages.push(text);
    }

    return { humanMessages, assistantMessages };
  }

  private extractTitle(humanMessages: string[]): string {
    if (humanMessages.length === 0) return 'Untitled session';
    const first = humanMessages[0].trim().split('\n')[0];
    return first.length > 80 ? first.slice(0, 80) + '...' : first;
  }

  private extractObjective(humanMessages: string[]): string {
    if (humanMessages.length === 0) return '';
    return humanMessages[0].trim();
  }

  private extractApproach(assistantMessages: string[]): string {
    const allAssistant = assistantMessages.join('\n');
    const matches: string[] = [];

    let m: RegExpExecArray | null;
    APPROACH_RE.lastIndex = 0;
    while ((m = APPROACH_RE.exec(allAssistant)) !== null) {
      const line = m[1].trim();
      if (line.length > 0) {
        matches.push(line.length > 200 ? line.slice(0, 200) + '...' : line);
      }
      if (matches.length >= 3) break;
    }

    return matches.join('; ') || '';
  }

  private extractFilesCreated(assistantMessages: string[]): string[] {
    const files = new Set<string>();
    const allText = assistantMessages.join('\n');

    // Look for "Created <path>" or "Creating <path>" patterns
    const createdRe = /(?:creat(?:ed|ing))\s+(?:file\s+)?[`']?([^\s`',;)}\]]+\.\w+)/gi;
    let m: RegExpExecArray | null;
    while ((m = createdRe.exec(allText)) !== null) {
      const path = m[1].trim();
      if (this.looksLikeFilePath(path)) files.add(path);
    }

    // Also look for tool_use create/Write patterns in raw text
    const writeRe = /(?:Write|create)\s*.*?file_path['":\s]+([^\s'"`,;)}\]]+)/gi;
    while ((m = writeRe.exec(allText)) !== null) {
      const path = m[1].trim();
      if (this.looksLikeFilePath(path)) files.add(path);
    }

    return [...files];
  }

  private extractFilesModified(assistantMessages: string[]): string[] {
    const files = new Set<string>();
    const allText = assistantMessages.join('\n');

    // Generic file path extraction from code blocks and tool references
    FILE_PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FILE_PATH_RE.exec(allText)) !== null) {
      const path = m[1].replace(/[`'"]+$/, '').trim();
      if (this.looksLikeFilePath(path)) files.add(path);
    }

    // Look for "Modified <path>" or "Editing <path>" or "Updated <path>"
    const modifiedRe =
      /(?:modif(?:ied|ying)|edit(?:ed|ing)|updat(?:ed|ing))\s+(?:file\s+)?[`']?([^\s`',;)}\]]+\.\w+)/gi;
    while ((m = modifiedRe.exec(allText)) !== null) {
      const path = m[1].trim();
      if (this.looksLikeFilePath(path)) files.add(path);
    }

    return [...files];
  }

  private extractDecisions(assistantMessages: string[]): string[] {
    const decisions: string[] = [];
    const allText = assistantMessages.join('\n');

    DECISION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECISION_RE.exec(allText)) !== null) {
      const decision = m[1].trim();
      if (decision.length > 0) {
        decisions.push(decision.length > 200 ? decision.slice(0, 200) + '...' : decision);
      }
      if (decisions.length >= 10) break;
    }

    return decisions;
  }

  private extractErrors(assistantMessages: string[]): string[] {
    const errors: string[] = [];

    for (const msg of assistantMessages) {
      for (const line of msg.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && ERROR_RE.test(trimmed)) {
          const errorLine = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
          errors.push(errorLine);
          if (errors.length >= 20) return errors;
        }
      }
    }

    return errors;
  }

  private extractOutcome(assistantMessages: string[]): string {
    if (assistantMessages.length === 0) return 'unknown';

    const lastMsg = assistantMessages[assistantMessages.length - 1].toLowerCase();

    const successPatterns = ['done', 'complete', 'completed', 'success', 'finished', 'all tests pass', 'working'];
    const failurePatterns = ['error', 'failed', 'failure', 'cannot', 'unable'];

    for (const p of successPatterns) {
      if (lastMsg.includes(p)) return 'success';
    }
    for (const p of failurePatterns) {
      if (lastMsg.includes(p)) return 'failure';
    }

    return 'partial';
  }

  private extractNextSteps(assistantMessages: string[]): string[] {
    const steps: string[] = [];
    const allText = assistantMessages.join('\n');
    const lines = allText.split('\n');

    let inNextSteps = false;

    for (const line of lines) {
      if (NEXT_STEP_HEADERS_RE.test(line)) {
        inNextSteps = true;
        // If the header line itself contains content after the keyword, skip it
        continue;
      }

      if (inNextSteps) {
        const trimmed = line.trim();
        // Stop on blank line or new section header
        if (trimmed === '' || /^#{1,3}\s/.test(trimmed)) {
          inNextSteps = false;
          continue;
        }
        // Capture bullet points and numbered items
        const cleaned = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '');
        if (cleaned.length > 0) {
          steps.push(cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned);
          if (steps.length >= 10) break;
        }
      }
    }

    // Also look for inline "still need to ..." patterns
    const inlineRe = /still need to\s+(.+?)(?:\.|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(allText)) !== null) {
      const step = m[1].trim();
      if (step.length > 0 && !steps.includes(step)) {
        steps.push(step.length > 200 ? step.slice(0, 200) + '...' : step);
      }
      if (steps.length >= 10) break;
    }

    return steps;
  }

  private looksLikeFilePath(path: string): boolean {
    // Must contain a dot (extension) or end with /
    if (!path.includes('.') && !path.endsWith('/')) return false;
    // Must not be a URL
    if (path.startsWith('http://') || path.startsWith('https://')) return false;
    // Must contain a slash
    if (!path.includes('/')) return false;
    return true;
  }
}
