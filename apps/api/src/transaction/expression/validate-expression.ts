export interface ExpressionValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Deterministic well-formedness check for a line-item `formula` — legal characters,
 * declared symbols only, balanced parentheses, and valid operand/operator structure.
 * Does NOT evaluate. Used to flag malformed expressions in the audit log at extraction
 * (the only place a formula is authored). Binary operators only — unary +/- is rejected.
 */
export function validateExpression(
  formula: string,
  symbols: string[],
): ExpressionValidation {
  const source = formula.trim();
  if (source === '') return { ok: false, issues: ['empty formula'] };

  const known = new Set(symbols);
  const tokens =
    source.match(/[0-9]*\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*|[+\-*/()]|\S/g) ?? [];
  const isNumber = (t: string) => /^[0-9]*\.?[0-9]+$/.test(t);
  const isIdent = (t: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t);

  const issues: string[] = [];
  let depth = 0;
  let expectOperand = true; // an operand (value or `(`) is legal here
  let malformed = false; // latch — report the structural break once

  const breakStructure = () => {
    if (!malformed) issues.push('malformed expression');
    malformed = true;
  };

  for (const t of tokens) {
    if (isNumber(t) || isIdent(t)) {
      if (isIdent(t) && !known.has(t)) issues.push(`unknown symbol "${t}"`);
      if (!expectOperand) breakStructure();
      expectOperand = false;
    } else if (t === '(') {
      if (!expectOperand) breakStructure();
      depth++;
      expectOperand = true;
    } else if (t === ')') {
      if (expectOperand) breakStructure(); // empty parens or dangling operator
      depth--;
      expectOperand = false;
    } else if (t === '+' || t === '-' || t === '*' || t === '/') {
      if (expectOperand) breakStructure(); // leading op or two in a row
      expectOperand = true;
    } else {
      issues.push(`illegal token "${t}"`);
      malformed = true;
    }
  }

  if (depth !== 0) issues.push('unbalanced parentheses');
  if (expectOperand && !malformed) issues.push('malformed expression'); // trailing operator

  const unique = [...new Set(issues)];
  return { ok: unique.length === 0, issues: unique };
}
