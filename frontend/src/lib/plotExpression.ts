// R29 — a tiny, TOTAL expression evaluator for plotted functions.
//
// Mentor- and teacher-authored graphs carry a formula as a STRING ("sin(x)", "2*x^2 - 3").
// Compiling that into JS at runtime would hand arbitrary code a foothold in the student's
// session for the sake of drawing a curve, so this is a hand-written shunting-yard parser
// over a fixed grammar: numbers, `x`, `pi`/`e`, + - * / ^, unary minus, parentheses, and a
// closed whitelist of single-argument functions (plus two-argument min/max/atan2). Anything
// outside the grammar fails to parse and the block renders its error instead of a curve.
//
// Parse once, evaluate ~200 times per curve: parseExpression returns a closure over the
// token stream's RPN form, so plotting is a cheap loop with no re-parsing per sample.

const FUNCTIONS_1: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  csc: (v) => 1 / Math.sin(v),
  sec: (v) => 1 / Math.cos(v),
  cot: (v) => 1 / Math.tan(v),
};

const FUNCTIONS_2: Record<string, (a: number, b: number) => number> = {
  min: Math.min,
  max: Math.max,
  atan2: Math.atan2,
  pow: Math.pow,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

// `"constructor" in FUNCTIONS_1` is TRUE for an object literal — every inherited
// Object.prototype key would otherwise resolve as a "known function" and be called with the
// sample value. Membership is always own-property membership here.
const has = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

type Token =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "sep" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = src.toLowerCase().replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const value = Number(s.slice(i, j));
      if (!Number.isFinite(value)) throw new Error(`Bad number in "${src}"`);
      tokens.push({ t: "num", v: value });
      i = j;
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z0-9_]/.test(s[j])) j += 1;
      const word = s.slice(i, j);
      i = j;
      if (word === "x") tokens.push({ t: "var" });
      else if (has(CONSTANTS, word)) tokens.push({ t: "num", v: CONSTANTS[word] });
      else if (has(FUNCTIONS_1, word) || has(FUNCTIONS_2, word)) tokens.push({ t: "fn", v: word });
      else throw new Error(`Unknown name "${word}"`);
      continue;
    }
    if ("+-*/^".includes(c)) {
      tokens.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp" });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i += 1;
      continue;
    }
    if (c === ",") {
      tokens.push({ t: "sep" });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

type RpnItem =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "op"; v: string }
  | { t: "fn"; v: string; argc: number };

// Unary minus binds LOOSER than exponentiation, so -x^2 is -(x^2) — the convention every
// textbook and calculator uses. Putting it above ^ would make -3^2 evaluate to 9.
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, u: 2.5, "^": 3 };

function toRpn(tokens: Token[]): RpnItem[] {
  const out: RpnItem[] = [];
  const stack: Array<{ t: "op"; v: string } | { t: "fn"; v: string } | { t: "lp" }> = [];
  const argc: number[] = [];
  let prev: Token | null = null;

  for (const token of tokens) {
    if (token.t === "num" || token.t === "var") {
      out.push(token.t === "num" ? { t: "num", v: token.v } : { t: "var" });
    } else if (token.t === "fn") {
      stack.push({ t: "fn", v: token.v });
      argc.push(1);
    } else if (token.t === "sep") {
      while (stack.length && stack[stack.length - 1].t !== "lp") {
        const top = stack.pop()!;
        if (top.t !== "lp")
          out.push(top.t === "op" ? { t: "op", v: top.v } : { t: "fn", v: top.v, argc: 1 });
      }
      if (argc.length) argc[argc.length - 1] += 1;
    } else if (token.t === "op") {
      // Unary minus/plus: at the start, after another operator, or after "(" / ",".
      const unary =
        (token.v === "-" || token.v === "+") &&
        (prev === null || prev.t === "op" || prev.t === "lp" || prev.t === "sep");
      const name = unary ? (token.v === "-" ? "u" : "u+") : token.v;
      if (name === "u+") {
        prev = token;
        continue; // unary plus is a no-op
      }
      const prec = PRECEDENCE[name] ?? 0;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t !== "op") break;
        const topPrec = PRECEDENCE[top.v] ?? 0;
        // ^ and unary minus are right-associative.
        const rightAssoc = name === "^" || name === "u";
        if (topPrec > prec || (topPrec === prec && !rightAssoc)) {
          out.push({ t: "op", v: (stack.pop() as { v: string }).v });
        } else break;
      }
      stack.push({ t: "op", v: name });
    } else if (token.t === "lp") {
      stack.push({ t: "lp" });
    } else {
      let matched = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.t === "lp") {
          matched = true;
          break;
        }
        out.push(top.t === "op" ? { t: "op", v: top.v } : { t: "fn", v: top.v, argc: 1 });
      }
      if (!matched) throw new Error("Unbalanced parentheses");
      if (stack.length && stack[stack.length - 1].t === "fn") {
        const fn = stack.pop() as { t: "fn"; v: string };
        out.push({ t: "fn", v: fn.v, argc: argc.pop() ?? 1 });
      }
    }
    prev = token;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp") throw new Error("Unbalanced parentheses");
    out.push(top.t === "op" ? { t: "op", v: top.v } : { t: "fn", v: top.v, argc: 1 });
  }
  return out;
}

export type PlotFunction = (x: number) => number;

// Returns an evaluator, or throws with a human-readable reason the block can display.
export function parseExpression(source: string): PlotFunction {
  const rpn = toRpn(tokenize(source));
  if (!rpn.length) throw new Error("Empty expression");
  // Arity check at PARSE time: simulate the stack so "2+" or "sin()" fails loudly with a
  // reason the block can show, instead of silently evaluating to NaN and drawing nothing.
  let depth = 0;
  for (const item of rpn) {
    if (item.t === "num" || item.t === "var") depth += 1;
    else if (item.t === "op") depth -= item.v === "u" ? 0 : 1;
    else depth -= (item.argc === 2 && has(FUNCTIONS_2, item.v) ? 2 : 1) - 1;
    if (depth < 1) throw new Error(`Incomplete expression "${source}"`);
  }
  if (depth !== 1) throw new Error(`Incomplete expression "${source}"`);
  return (x: number) => {
    const stack: number[] = [];
    for (const item of rpn) {
      if (item.t === "num") stack.push(item.v);
      else if (item.t === "var") stack.push(x);
      else if (item.t === "op") {
        if (item.v === "u") {
          const a = stack.pop();
          if (a === undefined) return NaN;
          stack.push(-a);
          continue;
        }
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) return NaN;
        stack.push(
          item.v === "+"
            ? a + b
            : item.v === "-"
              ? a - b
              : item.v === "*"
                ? a * b
                : item.v === "/"
                  ? a / b
                  : Math.pow(a, b),
        );
      } else {
        if (item.argc === 2 && has(FUNCTIONS_2, item.v)) {
          const b = stack.pop();
          const a = stack.pop();
          if (a === undefined || b === undefined) return NaN;
          stack.push(FUNCTIONS_2[item.v](a, b));
        } else {
          const a = stack.pop();
          if (a === undefined) return NaN;
          const fn = FUNCTIONS_1[item.v];
          if (!fn) return NaN;
          stack.push(fn(a));
        }
      }
    }
    const result = stack.pop();
    return result === undefined ? NaN : result;
  };
}
