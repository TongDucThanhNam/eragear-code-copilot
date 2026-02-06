interface TokenizeResult {
  tokens: string[];
  error?: string;
}

const WHITESPACE_RE = /\s/;

function tokenizeInput(
  value: string,
  isSeparator: (char: string) => boolean,
  label: string
): TokenizeResult {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let isEscaped = false;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    tokens.push(current);
    current = "";
  };

  for (const char of value) {
    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      isEscaped = true;
      continue;
    }

    if (char === "'" || char === '"') {
      if (quote === char) {
        quote = null;
        continue;
      }
      if (!quote) {
        quote = char;
        continue;
      }
    }

    if (!quote && isSeparator(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  if (isEscaped) {
    current += "\\";
  }

  if (quote) {
    return { tokens, error: `${label} contains an unmatched quote.` };
  }

  pushCurrent();

  return { tokens };
}

export function parseArgsInput(value: string): {
  args?: string[];
  error?: string;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const result = tokenizeInput(
    value,
    (char) => char === "," || WHITESPACE_RE.test(char),
    "Arguments"
  );
  if (result.error) {
    return { error: result.error };
  }

  return { args: result.tokens.length > 0 ? result.tokens : undefined };
}

export function parseCommandInput(value: string): {
  command?: string;
  args?: string[];
  error?: string;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "Command is required." };
  }

  const result = tokenizeInput(
    value,
    (char) => WHITESPACE_RE.test(char),
    "Command"
  );
  if (result.error) {
    return { error: result.error };
  }

  if (result.tokens.length === 0) {
    return { error: "Command is required." };
  }

  const [command, ...args] = result.tokens;
  return {
    command,
    args: args.length > 0 ? args : undefined,
  };
}
