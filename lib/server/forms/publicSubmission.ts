const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicFormAnswers = Record<string, string | string[]>;

export function parsePublicFormAnswers(value: unknown): PublicFormAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Please review the submitted answers.");
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length > 50) {
    throw new Error("This form contains too many answers.");
  }

  const answers: PublicFormAnswers = {};
  for (const [key, answer] of Object.entries(source)) {
    if (!UUID_PATTERN.test(key)) throw new Error("Invalid form answer.");
    if (typeof answer === "string") {
      const clean = answer.trim();
      if (clean.length > 5000) throw new Error("An answer is too long.");
      answers[key] = clean;
      continue;
    }
    if (Array.isArray(answer) && answer.length <= 50) {
      const clean = answer.map((item) => {
        if (typeof item !== "string") throw new Error("Invalid form answer.");
        const text = item.trim();
        if (!text || text.length > 120) throw new Error("Invalid form answer.");
        return text;
      });
      answers[key] = [...new Set(clean)];
      continue;
    }
    throw new Error("Invalid form answer.");
  }

  if (JSON.stringify(answers).length > 60_000) {
    throw new Error("The submitted answers are too large.");
  }
  return answers;
}
