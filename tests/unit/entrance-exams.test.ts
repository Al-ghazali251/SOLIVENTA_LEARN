import { describe, expect, it } from 'vitest';
import { importEntranceQuestions } from '../../src/entrance-exams/importer';
import { gradeEntranceObjectiveAnswers } from '../../src/entrance-exams/grading';

describe('entrance examination importing', () => {
  it('imports Markdown and extracts checked correct answers', () => {
    const result = importEntranceQuestions(`## Question 1\nPrompt: Capital of Nigeria?\nKind: single_choice\n- [ ] Lagos\n- [x] Abuja\nMarks: 2`, 'markdown');
    expect(result).toEqual([{ kind: 'single_choice', prompt: 'Capital of Nigeria?', options: ['Lagos', 'Abuja'], correctAnswer: 1, marks: 2 }]);
  });

  it('imports a YAML question list with inline and block values', () => {
    const result = importEntranceQuestions(`- prompt: Select primes\n  kind: multiple_choice\n  options:\n    - "2"\n    - "4"\n    - "5"\n  correctAnswer: [0, 2]\n  marks: 3\n- prompt: Explain gravity\n  kind: long_text\n  marks: 5`, 'yaml');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'multiple_choice', options: ['2', '4', '5'], correctAnswer: [0, 2], marks: 3 });
    expect(result[1]).toMatchObject({ kind: 'long_text', prompt: 'Explain gravity', marks: 5 });
  });

  it('rejects malformed, empty, and oversized sources', () => {
    expect(() => importEntranceQuestions('- prompt:\n  kind: unknown', 'yaml')).toThrow();
    expect(() => importEntranceQuestions('   ', 'markdown')).toThrow(/No questions/);
    expect(() => importEntranceQuestions('x'.repeat(500_001), 'markdown')).toThrow(/too large/);
  });
});

describe('entrance examination objective grading', () => {
  it('grades option keys deterministically and leaves free text pending review', () => {
    const result = gradeEntranceObjectiveAnswers([
      { id: 'one', kind: 'single_choice', options: ['Lagos', 'Abuja'], correct_answer: 'B', marks: 2 },
      { id: 'two', kind: 'multiple_choice', options: ['2', '4', '5'], correct_answer: [0, 2], marks: 3 },
      { id: 'three', kind: 'long_text', correct_answer: null, marks: 5 },
    ], [
      { question_id: 'one', answer: 1 },
      { question_id: 'two', answer: { selected: ['5', '2'] } },
      { question_id: 'three', answer: 'Gravity attracts masses.' },
    ]);
    expect(result).toMatchObject({ score: 5, maximumScore: 10, requiresReview: true });
    expect(result.awardedMarks).toEqual([
      { questionId: 'one', awardedMarks: 2 },
      { questionId: 'two', awardedMarks: 3 },
      { questionId: 'three', awardedMarks: null },
    ]);
  });
});
