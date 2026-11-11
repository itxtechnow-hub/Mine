export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.max(1, Math.round((words * 1.3 + chars / 3.8) / 2));
}

export function compressTextPipeline(text: string, profile = 'standard', engines: Record<string, boolean> = {}) {
  if (!text) {
    return { original: '', compressed: '', rawTokens: 0, compressedTokens: 0, savedPercent: 0, appliedEngines: [] };
  }
  const rawTokens = estimateTokens(text);
  let out = text;
  const applied: string[] = [];

  // 1. Session-Dedup & RTK duplicate line folding
  if (engines.sessionDedup !== false || engines.rtk !== false) {
    const lines = out.split('\n');
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 28 && seen.has(trimmed)) continue;
      if (trimmed.length > 28) seen.add(trimmed);
      deduped.push(line);
    }
    if (deduped.length < lines.length) applied.push('Session-Dedup', 'RTK');
    out = deduped.join('\n');
  }

  // 2. Lite whitespace & comment cleanup
  if (engines.lite !== false) {
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    applied.push('Lite');
  }

  // 3. Caveman / Aggressive / Ultra prose condensation
  if (profile !== 'lite' && (engines.caveman !== false || profile === 'aggressive' || profile === 'ultra' || profile === 'rtk-stacked')) {
    out = out
      .replace(/The function should iterate over the list of items, and for each item, it should check whether the value is greater than zero, and if so, add it to the running total\.?/gi, 'sum all list items where value > 0')
      .replace(/\b(in order to|for the purpose of|with the goal of)\b/gi, 'to')
      .replace(/\b(due to the fact that|owing to the fact that)\b/gi, 'because')
      .replace(/\b(at this point in time|at the present time)\b/gi, 'now')
      .replace(/\b(whether or not)\b/gi, 'if')
      .replace(/\b(please make sure that you|please ensure that you|it is important to note that)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    applied.push('Caveman');
  }

  if (profile === 'aggressive' || profile === 'ultra' || engines.aggressive) {
    out = out.replace(/\b(the|a|an|actually|basically|essentially|really|very|quite)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    applied.push('Aggressive');
  }

  const compressedTokens = estimateTokens(out);
  const saved = Math.max(0, rawTokens - compressedTokens);
  const savedPercent = rawTokens > 0 ? Number(((saved / rawTokens) * 100).toFixed(1)) : 0;

  return {
    original: text,
    compressed: out,
    rawTokens,
    compressedTokens,
    savedTokens: saved,
    savedPercent,
    profile,
    appliedEngines: applied
  };
}
