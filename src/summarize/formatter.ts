/**
 * Formats extracted session data into a readable handoff summary.
 */

import type { ExtractedSession } from './extractor.js';

export function formatHandoffSummary(extracted: ExtractedSession, agent: string): string {
  const parts: string[] = [];

  parts.push(`## Session: ${extracted.title}`);
  parts.push(`**Agent**: ${agent} | **Outcome**: ${extracted.outcome}`);
  parts.push('');

  if (extracted.objective) {
    parts.push('### Objective');
    parts.push(extracted.objective);
    parts.push('');
  }

  if (extracted.approach) {
    parts.push('### Approach');
    parts.push(extracted.approach);
    parts.push('');
  }

  const hasFiles = extracted.filesCreated.length > 0 || extracted.filesModified.length > 0;
  const hasDecisions = extracted.decisions.length > 0;

  if (hasFiles || hasDecisions) {
    parts.push('### What was done');
    if (extracted.filesCreated.length > 0) {
      parts.push(`- Created: ${extracted.filesCreated.join(', ')}`);
    }
    if (extracted.filesModified.length > 0) {
      parts.push(`- Modified: ${extracted.filesModified.join(', ')}`);
    }
    if (hasDecisions) {
      parts.push(`- Decisions: ${extracted.decisions.join(', ')}`);
    }
    parts.push('');
  }

  if (extracted.errors.length > 0) {
    parts.push('### Issues encountered');
    for (const error of extracted.errors) {
      parts.push(`- ${error}`);
    }
    parts.push('');
  }

  if (extracted.nextSteps.length > 0) {
    parts.push('### Next steps');
    for (const step of extracted.nextSteps) {
      parts.push(`- ${step}`);
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}
