export interface DiffResult {
  diff: string;
  isSubstantial: boolean;
}

/**
 * 检测输出变化是否是"实质性"的（新增内容），而不是原地更新（如进度条、状态更新）
 */
function isSubstantialChange(previous: string, current: string, diff: string): boolean {
  if (!previous) return diff.trim().length > 0;
  if (!diff || diff.trim().length === 0) return false;

  const prevLines = previous.split('\n');
  const currLines = current.split('\n');

  // 如果行数增加，说明有新内容
  if (currLines.length > prevLines.length) return true;

  // 如果行数相同，检查是否只是最后几行的原地更新
  if (currLines.length === prevLines.length) {
    // 检查前面的行是否完全相同
    const unchangedLines = prevLines.slice(0, -3).every((line, i) => line === currLines[i]);
    if (unchangedLines) {
      // 只有最后几行变化，可能是状态更新
      const lastDiff = diff.trim();

      // 检测 Claude Code 的状态更新模式
      const statusPatterns = [
        /Transfiguring\.\.\./,
        /Running\.\.\./,
        /\d+m \d+s/,  // 时间计数
        /\d+\.?\d*k tokens/,  // token 计数
        /\(\d+m \d+s · \d+\.?\d*k tokens\)/,  // 完整的状态行
      ];

      return !statusPatterns.some(pattern => pattern.test(lastDiff));
    }
  }

  return true;
}

export function diffPaneOutput(previous: string, current: string): DiffResult {
  if (!previous) {
    const diff = current;
    return {
      diff,
      isSubstantial: diff.trim().length > 0
    };
  }

  let diff = "";
  if (current.startsWith(previous)) {
    diff = current.slice(previous.length);
  } else {
    const maxOverlap = Math.min(previous.length, current.length);
    let found = false;
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      if (previous.slice(previous.length - overlap) === current.slice(0, overlap)) {
        diff = current.slice(overlap);
        found = true;
        break;
      }
    }
    if (!found) {
      diff = current;
    }
  }

  return {
    diff,
    isSubstantial: isSubstantialChange(previous, current, diff)
  };
}
