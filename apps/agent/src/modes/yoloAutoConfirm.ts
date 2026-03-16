const patterns: Array<{ re: RegExp; reply: string }> = [
  { re: /\(\s*y\s*\/\s*n\s*\)/i, reply: "y\n" },
  { re: /\[\s*y\s*\/\s*n\s*\]/i, reply: "y\n" },
  { re: /\[\s*y\s*\/\s*N\s*\]/, reply: "y\n" },
  { re: /\[\s*Y\s*\/\s*n\s*\]/, reply: "y\n" },
  { re: /are you sure/i, reply: "yes\n" },
  { re: /continue\?\s*$/i, reply: "y\n" },
  { re: /proceed\?\s*$/i, reply: "y\n" },
  { re: /confirm\?\s*$/i, reply: "y\n" }
];

export function autoConfirmResponse(outputChunk: string): string | undefined {
  const s = outputChunk.slice(-500);
  for (const p of patterns) {
    if (p.re.test(s)) return p.reply;
  }
  return undefined;
}
