import { connection } from "next/server";
import { StudyWorkspace } from "@/components/study-workspace";

export default async function Page() {
  await connection();
  return <StudyWorkspace configured={Boolean(process.env.GEMINI_API_KEY)} />;
}
