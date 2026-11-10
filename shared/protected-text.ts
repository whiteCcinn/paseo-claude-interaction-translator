/** Markdown spans whose bytes must survive translation unchanged. */
export interface ProtectedText {
  text: string;
  prefix: string;
  values: string[];
}

export function protectText(text: string): ProtectedText {
  let prefix = "__PASEO_KEEP_";
  if (text.includes(prefix)) {
    const occupied = new Set(Array.from(text.matchAll(/__PASEO_KEEP_(\d+)_/g), (match) => match[1]));
    let candidate = 0;
    while (occupied.has(String(candidate))) candidate += 1;
    prefix += `${candidate}_`;
  }
  const values: string[] = [];
  const keep = (value: string): string => `${prefix}${values.push(value) - 1}__`;
  const pathsAndUrls = /"[^"\r\n]*[/\\][^"\r\n]*"|'[^'\r\n]*[/\\][^'\r\n]*'|(?:https?|ftp):\/\/[^\s\x00-\x1f<>"'`，、。！？；（）]+|(?:[A-Za-z]:[/\\]|\\\\|~\/|\.{1,2}\/|\/)[^\s\x00-\x1f`"'<>，、。！？；（）\[\]{}(),;!?]+|(?<![\p{L}\p{N}\p{M}_@./\\-])[\p{L}\p{N}\p{M}_@.-]+(?:[/\\][\p{L}\p{N}\p{M}_@.%:+~-]+)+/gu;
  const maskInlineAndPaths = (part: string): string => {
    // Index matching delimiter runs once: a regular expression with a variable
    // backreference can take quadratic time for long unmatched backtick runs.
    const runs = Array.from(part.matchAll(/`+/g));
    const nextSame: Array<number | undefined> = [];
    const lastByLength = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index];
      if (!run) continue;
      nextSame[index] = lastByLength.get(run[0].length);
      lastByLength.set(run[0].length, index);
    }
    const pieces: string[] = [];
    let start = 0;
    for (let index = 0; index < runs.length; index += 1) {
      const opening = runs[index];
      const closingIndex = nextSame[index];
      const closing = closingIndex === undefined ? undefined : runs[closingIndex];
      if (!opening || !closing || closingIndex === undefined) continue;
      pieces.push(part.slice(start, opening.index).replace(pathsAndUrls, keep));
      start = closing.index + closing[0].length;
      pieces.push(keep(part.slice(opening.index, start)));
      index = closingIndex;
    }
    pieces.push(part.slice(start).replace(pathsAndUrls, keep));
    return pieces.join("");
  };
  const maskSpans = (part: string): string => {
    // A conservative Markdown code boundary also preserves indented snippets.
    const pieces: string[] = [];
    let cursor = 0;
    let blockStart: number | undefined;
    let blockEnd = 0;
    const flushBlock = (): void => {
      if (blockStart === undefined) return;
      pieces.push(maskInlineAndPaths(part.slice(cursor, blockStart)));
      pieces.push(keep(part.slice(blockStart, blockEnd)));
      cursor = blockEnd;
      blockStart = undefined;
    };
    for (let lineStart = 0; lineStart < part.length;) {
      const newline = part.indexOf("\n", lineStart);
      const lineEnd = newline < 0 ? part.length : newline + 1;
      const line = part.slice(lineStart, lineEnd);
      if (/^(?: {4}|\t)/.test(line)) {
        blockStart ??= lineStart;
        blockEnd = lineEnd;
      } else if (blockStart !== undefined && /^[ \t\r\n]*$/.test(line)) {
        blockEnd = lineEnd;
      } else flushBlock();
      lineStart = lineEnd;
    }
    flushBlock();
    pieces.push(maskInlineAndPaths(part.slice(cursor)));
    return pieces.join("");
  };
  const fences = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
  const parts: string[] = [];
  let cursor = 0;
  let opening: RegExpExecArray | null;
  while ((opening = fences.exec(text)) !== null) {
    const fence = opening[1];
    if (!fence) break;
    const character = fence.startsWith("`") ? "`" : "~";
    const closing = new RegExp(`^ {0,3}${character}{${fence.length},}[ \\t]*(?=\\r?$)`, "gm");
    closing.lastIndex = fences.lastIndex;
    const match = closing.exec(text);
    const end = match ? match.index + match[0].length : text.length;
    parts.push(maskSpans(text.slice(cursor, opening.index)));
    parts.push(keep(text.slice(opening.index, end)));
    cursor = end;
    fences.lastIndex = end;
  }
  parts.push(maskSpans(text.slice(cursor)));
  return { text: parts.join(""), prefix, values };
}

export function restoreText(text: string, protectedText: ProtectedText): string | undefined {
  // Validate the complete placeholder set before inserting original values. Source
  // values may themselves resemble placeholders, so restoration is a single pass.
  const markerPattern = new RegExp(`${protectedText.prefix}(\\d+)__`, "g");
  const seen = new Set<number>();
  let invalid = false;
  const restored = text.replace(markerPattern, (_marker: string, rawIndex: string) => {
    const index = Number(rawIndex);
    const value = protectedText.values[index];
    if (String(index) !== rawIndex || value === undefined || seen.has(index)) {
      invalid = true;
      return "";
    }
    seen.add(index);
    return value;
  });
  const remainder = text.replace(markerPattern, "");
  return invalid || seen.size !== protectedText.values.length || remainder.includes(protectedText.prefix)
    ? undefined : restored;
}
