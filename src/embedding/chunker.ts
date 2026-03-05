// Text chunking for embedding long texts into ~500 token segments

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 50;

export function chunkText(
  text: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  overlapTokens = DEFAULT_OVERLAP_TOKENS,
): string[] {
  if (!text || text.trim().length === 0) return [];

  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;

  // Short text: return as-is
  if (text.length <= maxChars) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Try to break at a paragraph or sentence boundary
    const segment = text.slice(start, end);
    const lastParagraph = segment.lastIndexOf('\n\n');
    const lastNewline = segment.lastIndexOf('\n');
    const lastSentence = segment.lastIndexOf('. ');

    if (lastParagraph > maxChars * 0.5) {
      end = start + lastParagraph;
    } else if (lastNewline > maxChars * 0.5) {
      end = start + lastNewline;
    } else if (lastSentence > maxChars * 0.5) {
      end = start + lastSentence + 2; // Include the period and space
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlapChars;
  }

  return chunks.filter((c) => c.length > 0);
}
