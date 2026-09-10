import type {
  GeneratedQuiz,
  QuizAttempt,
  QuizDifficulty,
  QuizQuestion,
  TopicPerformance,
} from "./types";

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : undefined;
}

export function normalizeQuizPayload(
  payload: unknown,
  difficulty: QuizDifficulty,
  questionCount: 5 | 10,
  sourceIds: string[],
  sourceNames: string[],
): GeneratedQuiz | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = payload as { title?: unknown; questions?: unknown };
  const title = cleanString(raw.title, 160);
  if (!title || !Array.isArray(raw.questions) || raw.questions.length !== questionCount) return undefined;

  const questions: QuizQuestion[] = [];
  for (const [index, item] of raw.questions.entries()) {
    if (!item || typeof item !== "object") return undefined;
    const question = item as {
      question?: unknown;
      options?: unknown;
      correctOptionIndex?: unknown;
      topic?: unknown;
      explanation?: unknown;
    };
    const questionText = cleanString(question.question, 600);
    const topic = cleanString(question.topic, 120);
    const explanation = cleanString(question.explanation, 1_200);
    if (!questionText || !topic || !explanation || !Array.isArray(question.options) || question.options.length !== 4) return undefined;

    const options = question.options.map((option) => cleanString(option, 320));
    if (options.some((option) => !option) || new Set(options).size !== 4) return undefined;
    if (!Number.isInteger(question.correctOptionIndex) || Number(question.correctOptionIndex) < 0 || Number(question.correctOptionIndex) > 3) return undefined;

    questions.push({
      id: `q${index + 1}`,
      question: questionText,
      options: options as [string, string, string, string],
      correctOptionIndex: Number(question.correctOptionIndex),
      topic,
      explanation,
    });
  }

  return {
    id: `quiz-${crypto.randomUUID()}`,
    title,
    difficulty,
    questions,
    sourceIds,
    sourceNames,
    createdAt: new Date().toISOString(),
  };
}

export function scoreLabel(percentage: number) {
  if (percentage >= 90) return "Excellent";
  if (percentage >= 75) return "Strong";
  if (percentage >= 60) return "Good Progress";
  if (percentage >= 40) return "Needs Revision";
  return "Let's Strengthen the Basics";
}

export function fallbackRecommendation(weakTopics: string[], developingTopics: string[]) {
  const priorities = [...weakTopics, ...developingTopics].slice(0, 4);
  return priorities.length
    ? `Review ${priorities.join(", ")}. Revisit the core ideas, then test yourself again with a fresh set of questions.`
    : "Excellent foundation. Reinforce your strongest topics with a harder quiz and explain each answer in your own words.";
}

export function evaluateQuiz(
  quiz: GeneratedQuiz,
  selectedAnswers: Array<number | null>,
  startedAt: number,
  completedAt = Date.now(),
): QuizAttempt {
  let correctAnswers = 0;
  let unanswered = 0;
  const topics = new Map<string, { topic: string; correct: number; total: number }>();

  quiz.questions.forEach((question, index) => {
    const answer = selectedAnswers[index] ?? null;
    const correct = answer === question.correctOptionIndex;
    if (answer === null) unanswered += 1;
    if (correct) correctAnswers += 1;

    const key = question.topic.trim().toLocaleLowerCase();
    const performance = topics.get(key) ?? { topic: question.topic.trim(), correct: 0, total: 0 };
    performance.total += 1;
    if (correct) performance.correct += 1;
    topics.set(key, performance);
  });

  const topicPerformance: TopicPerformance[] = Array.from(topics.values()).map((topic) => {
    const accuracy = Math.round((topic.correct / topic.total) * 100);
    return {
      ...topic,
      accuracy,
      status: accuracy < 60 ? "weak" : accuracy >= 80 ? "strong" : "developing",
    };
  });
  const percentage = Math.round((correctAnswers / quiz.questions.length) * 100);
  const weakTopics = topicPerformance.filter((topic) => topic.status === "weak").map((topic) => topic.topic);
  const developingTopics = topicPerformance.filter((topic) => topic.status === "developing").map((topic) => topic.topic);
  const strongTopics = topicPerformance.filter((topic) => topic.status === "strong").map((topic) => topic.topic);

  return {
    id: `attempt-${crypto.randomUUID()}`,
    quizId: quiz.id,
    title: quiz.title,
    createdAt: quiz.createdAt,
    completedAt: new Date(completedAt).toISOString(),
    difficulty: quiz.difficulty,
    sourceIds: quiz.sourceIds,
    sourceNames: quiz.sourceNames,
    questionCount: quiz.questions.length,
    correctAnswers,
    incorrectAnswers: quiz.questions.length - correctAnswers - unanswered,
    unanswered,
    percentage,
    durationSeconds: Math.max(0, Math.round((completedAt - startedAt) / 1_000)),
    weakTopics,
    developingTopics,
    strongTopics,
    topicPerformance,
    questions: quiz.questions,
    selectedAnswers: quiz.questions.map((_, index) => selectedAnswers[index] ?? null),
    recommendation: fallbackRecommendation(weakTopics, developingTopics),
  };
}

export function formatQuizDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}
