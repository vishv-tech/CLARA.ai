import Link from "next/link";

export function PlaceholderPage({ kind }: { kind: "study" | "leaderboard" }) {
  const isStudy = kind === "study";
  return (
    <div className="placeholder-page">
      <div className="placeholder-orbit"><span>{isStudy ? "✦" : "♜"}</span><i /><i /><i /></div>
      <p className="eyebrow">{isStudy ? "LEARN WITH YOUR OWN SOURCES" : "CONSISTENCY MEETS COMMUNITY"}</p>
      <h1>{isStudy ? "SAGE Study Workspace" : "SAGE Leaderboard"}</h1>
      <p>{isStudy ? "Chat with your academic sources, generate quizzes and learn with SAGE." : "Compete through learning consistency, not just marks."}</p>
      <span className="coming-badge">{isStudy ? "COMING IN SPRINT 2" : "COMING SOON"}</span>
      <Link className="secondary-button" href="/">← Back to dashboard</Link>
    </div>
  );
}
