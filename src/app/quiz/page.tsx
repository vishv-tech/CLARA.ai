import { connection } from "next/server";
import { QuizPage } from "@/components/quiz-page";

export default async function Page() {
  await connection();
  return <QuizPage configured={Boolean(process.env.GEMINI_API_KEY)} />;
}
