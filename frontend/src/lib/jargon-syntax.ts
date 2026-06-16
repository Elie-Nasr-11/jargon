export const JARGON_LANGUAGE_ID = "jargon";

export type JargonTokenKind =
  | "plain"
  | "command"
  | "condition"
  | "comment"
  | "string"
  | "number"
  | "bracket";

export type JargonToken = {
  kind: JargonTokenKind;
  text: string;
};

export const JARGON_COMMANDS = [
  "SET",
  "PRINT",
  "ADD",
  "REMOVE",
  "ASK",
  "IF",
  "THEN",
  "ELSE",
  "END",
  "REPEAT",
  "REPEAT_UNTIL",
  "REPEAT_FOR_EACH",
  "BREAK",
] as const;

export const JARGON_CONDITION_WORDS = ["AND", "OR"] as const;

export const JARGON_CONDITION_PHRASES = [
  "is greater than or equal to",
  "is less than or equal to",
  "is not equal to",
  "is greater than",
  "is less than",
  "is equal to",
  "reaches end of",
  "is even",
  "is odd",
  "is in",
] as const;

const commandSet = new Set<string>(JARGON_COMMANDS);
const conditionWordSet = new Set<string>(JARGON_CONDITION_WORDS);
const wordPattern = /^[A-Za-z_][A-Za-z0-9_]*/;
const numberPattern = /^\d+(?:\.\d+)?/;
const conditionPatterns = JARGON_CONDITION_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(
    `^${phrase
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")}\\b`,
    "i",
  ),
}));

function isLinePrefixWhitespace(source: string, index: number) {
  let cursor = index - 1;
  while (cursor >= 0 && source[cursor] !== "\n") {
    if (!/\s/.test(source[cursor])) return false;
    cursor -= 1;
  }
  return true;
}

function takeUntilLineEnd(source: string, index: number) {
  const nextLine = source.indexOf("\n", index);
  return nextLine === -1 ? source.length : nextLine;
}

function takeString(source: string, index: number) {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\" && cursor + 1 < source.length) {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

export function tokenizeJargon(source: string): JargonToken[] {
  const tokens: JargonToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const slice = source.slice(cursor);

    if (source.startsWith("//", cursor) && isLinePrefixWhitespace(source, cursor)) {
      const end = takeUntilLineEnd(source, cursor);
      tokens.push({ kind: "comment", text: source.slice(cursor, end) });
      cursor = end;
      continue;
    }

    if (source[cursor] === "#") {
      const end = takeUntilLineEnd(source, cursor);
      tokens.push({ kind: "comment", text: source.slice(cursor, end) });
      cursor = end;
      continue;
    }

    if (source[cursor] === '"' || source[cursor] === "'") {
      const end = takeString(source, cursor);
      tokens.push({ kind: "string", text: source.slice(cursor, end) });
      cursor = end;
      continue;
    }

    const condition = conditionPatterns.find(({ pattern }) => pattern.test(slice));
    if (condition) {
      const text = slice.match(condition.pattern)?.[0] || "";
      tokens.push({ kind: "condition", text });
      cursor += text.length;
      continue;
    }

    const word = slice.match(wordPattern)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      if (commandSet.has(upper)) {
        tokens.push({ kind: "command", text: word });
      } else if (conditionWordSet.has(upper)) {
        tokens.push({ kind: "condition", text: word });
      } else {
        tokens.push({ kind: "plain", text: word });
      }
      cursor += word.length;
      continue;
    }

    const number = slice.match(numberPattern)?.[0];
    if (number) {
      tokens.push({ kind: "number", text: number });
      cursor += number.length;
      continue;
    }

    if ("()[]{}".includes(source[cursor])) {
      tokens.push({ kind: "bracket", text: source[cursor] });
      cursor += 1;
      continue;
    }

    tokens.push({ kind: "plain", text: source[cursor] });
    cursor += 1;
  }

  return tokens;
}
