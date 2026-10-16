export type GradeBand = Readonly<{
  minimumPercent: number;
  grade: string;
  remark: string;
}>;

export type GradeResult = Readonly<{
  score: number;
  maximumScore: number;
  percentage: number;
  grade: string;
  remark: string;
}>;

export function gradeScore(
  score: number,
  maximumScore: number,
  bands: readonly GradeBand[],
): GradeResult {
  if (!Number.isFinite(score) || !Number.isFinite(maximumScore) || maximumScore <= 0)
    throw new Error('Maximum score must be greater than zero.');
  if (score < 0 || score > maximumScore) throw new Error('Score must be within the valid range.');
  if (bands.length === 0) throw new Error('At least one grade band is required.');

  const ordered = [...bands].sort((left, right) => right.minimumPercent - left.minimumPercent);
  if (ordered.some((band) => band.minimumPercent < 0 || band.minimumPercent > 100))
    throw new Error('Grade band thresholds must be between zero and one hundred.');
  const percentage = Number(((score / maximumScore) * 100).toFixed(2));
  const band = ordered.find((candidate) => percentage >= candidate.minimumPercent);
  if (!band) throw new Error('Grade bands must cover zero percent.');
  return { score, maximumScore, percentage, grade: band.grade, remark: band.remark };
}
