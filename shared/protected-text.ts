export function protectText(text: string): { text: string; prefix: string; values: string[] } {
  return { text, prefix: "__PASEO_KEEP_", values: [] };
}
export function restoreText(_text: string, _protectedText: ReturnType<typeof protectText>): string | undefined {
  return undefined;
}
