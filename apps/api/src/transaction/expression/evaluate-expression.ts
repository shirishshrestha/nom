/**
 * Evaluate a line-item `formula` over its resolved `symbols` to the expected amount.
 * Sibling to validateExpression: same grammar (binary `+ - * / ( )`, numeric literals,
 * symbol identifiers), so any formula that validates is evaluable here. Shunting-yard —
 * the string is never executed as code, so this can only ever do arithmetic.
 *
 * Fail-soft (mirrors resolution): returns null when the formula is null/empty, references
 * a symbol that is missing or still null, divides by zero, or produces a non-finite value.
 * Null means "cannot compute" — never a silent 0.
 */
export function evaluateExpression(
  formula: string | null,
  symbols: Record<string, number | null>,
): number | null {
  if (formula === null) return null;
  const source = formula.trim();
  if (source === '') return null;

  const tokens =
    source.match(/[0-9]*\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*|[+\-*/()]|\S/g) ?? [];
  const isNumber = (t: string) => /^[0-9]*\.?[0-9]+$/.test(t);
  const isIdent = (t: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t);

  const values: number[] = [];
  const ops: string[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

  // Pop `a op b` off the stacks; null propagates on divide-by-zero / non-finite.
  const apply = (): boolean => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op === undefined || a === undefined || b === undefined) return false;
    let r: number;
    switch (op) {
      case '+':
        r = a + b;
        break;
      case '-':
        r = a - b;
        break;
      case '*':
        r = a * b;
        break;
      case '/':
        if (b === 0) return false;
        r = a / b;
        break;
      default:
        return false;
    }
    if (!Number.isFinite(r)) return false;
    values.push(r);
    return true;
  };

  for (const t of tokens) {
    if (isNumber(t)) {
      values.push(Number(t));
    } else if (isIdent(t)) {
      const v = symbols[t];
      if (v === undefined || v === null || !Number.isFinite(v)) return null;
      values.push(v);
    } else if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length > 0 && ops[ops.length - 1] !== '(') {
        if (!apply()) return null;
      }
      if (ops.pop() !== '(') return null; // unbalanced
    } else if (t in precedence) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== '(' &&
        precedence[ops[ops.length - 1]] >= precedence[t]
      ) {
        if (!apply()) return null;
      }
      ops.push(t);
    } else {
      return null; // illegal token — grammar violation
    }
  }

  while (ops.length > 0) {
    if (ops[ops.length - 1] === '(') return null; // unbalanced
    if (!apply()) return null;
  }

  if (values.length !== 1) return null;
  return Number.isFinite(values[0]) ? values[0] : null;
}
