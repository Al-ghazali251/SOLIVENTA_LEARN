export type EntranceQuestionForGrading = {
  id: string;
  kind: string;
  options?: unknown;
  correct_answer?: unknown;
  marks: number | string;
};

export type EntranceAnswerForGrading = { question_id: string; answer: unknown };

const objectiveKinds = new Set(['single_choice', 'multiple_choice', 'true_false', 'number']);

function optionKey(value: unknown, options: unknown): string {
  if (typeof value === 'number') return String(value);
  const text = String(value).trim();
  const values = Array.isArray(options) ? options.map(String) : [];
  const optionIndex = values.indexOf(text);
  if (optionIndex >= 0) return String(optionIndex);
  if (/^[A-Za-z]$/.test(text)) return String(text.toUpperCase().charCodeAt(0) - 65);
  return text.toLowerCase();
}

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('selected' in record) return values(record.selected);
    if ('value' in record) return values(record.value);
  }
  return value === undefined || value === null || value === '' ? [] : [value];
}

export function gradeEntranceObjectiveAnswers(
  questions: EntranceQuestionForGrading[],
  answers: EntranceAnswerForGrading[],
) {
  const answerByQuestion = new Map(answers.map((answer) => [answer.question_id, answer.answer]));
  let score = 0;
  let maximumScore = 0;
  let requiresReview = false;
  const awardedMarks: { questionId: string; awardedMarks: number | null }[] = [];
  for (const question of questions) {
    const marks = Number(question.marks);
    maximumScore += marks;
    if (!objectiveKinds.has(question.kind) || question.correct_answer === undefined || question.correct_answer === null) {
      requiresReview = true;
      awardedMarks.push({ questionId: question.id, awardedMarks: null });
      continue;
    }
    const expected = values(question.correct_answer).map((value) => optionKey(value, question.options)).sort();
    const actual = values(answerByQuestion.get(question.id)).map((value) => optionKey(value, question.options)).sort();
    const correct = expected.length > 0 && expected.length === actual.length && expected.every((value, index) => value === actual[index]);
    const awarded = correct ? marks : 0;
    score += awarded;
    awardedMarks.push({ questionId: question.id, awardedMarks: awarded });
  }
  return { score, maximumScore, requiresReview, awardedMarks };
}
