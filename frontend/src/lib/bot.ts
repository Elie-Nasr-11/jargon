import type { MentorConfig } from "./jargon-store";

export type BotResponse = {
  text: string;
  code?: { language: "javascript" | "python"; source: string };
};

const sample = {
  jsLoop: `// A classic for-loop
for (let i = 1; i <= 5; i++) {
  console.log(\`tick \${i}\`);
}`,
  jsFn: `function greet(name) {
  return \`hello, \${name}\`;
}
console.log(greet("learner"));`,
  pyLoop: `# Same idea, Python flavor
for i in range(1, 6):
    print(f"tick {i}")`,
  pyFn: `def greet(name):
    return f"hello, {name}"

print(greet("learner"))`,
};

export function botReply(prompt: string, mentor: MentorConfig): BotResponse {
  const p = prompt.toLowerCase().trim();

  const intro = {
    Friendly: "Sure — ",
    Direct: "",
    Socratic: "Before I answer: ",
  }[mentor.tone];

  if (/python/.test(p) && /loop|for|while/.test(p)) {
    return {
      text: `${intro}here's a small loop in Python.`,
      code: { language: "python", source: sample.pyLoop },
    };
  }
  if (/python/.test(p) && /function|def/.test(p)) {
    return {
      text: `${intro}Python functions use \`def\`.`,
      code: { language: "python", source: sample.pyFn },
    };
  }
  if (/loop|for|while/.test(p)) {
    return {
      text: `${intro}here's the simplest loop.`,
      code: { language: "javascript", source: sample.jsLoop },
    };
  }
  if (/function|def|method/.test(p)) {
    return {
      text: `${intro}a tiny function, returning a string.`,
      code: { language: "javascript", source: sample.jsFn },
    };
  }
  if (/run|execute/.test(p)) {
    return {
      text: "Open the editor below (the \u2039/\u203A toggle) and press Run \u25B6 — the output will appear right here in the chat.",
    };
  }
  if (/hello|hi|hey/.test(p)) {
    return { text: `${intro}hey. What do you want to learn today?` };
  }
  if (/help|how/.test(p)) {
    return {
      text: `${intro}try asking me things like *show me a for loop*, *write a function in python*, or hit the \u2039/\u203A button to drop into the editor and run code yourself.`,
    };
  }

  const verbosityTail = {
    Concise: "",
    Balanced: " Tell me what part is fuzzy and I'll narrow in.",
    Detailed:
      " I can break it down with examples in JS or Python, or walk you through a tiny exercise — your call.",
  }[mentor.verbosity];

  return {
    text: `${intro}I hear you. Let's stay with that idea for a moment.${verbosityTail}`,
  };
}
