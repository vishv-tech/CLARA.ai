"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { StudyLeaderboardEntry } from "@/lib/types";

const PODIUM_LABELS = ["1st", "2nd", "3rd"] as const;

export function LeaderboardPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<StudyLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLeaderboard = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: leaderboardError } = await supabase.rpc("get_study_leaderboard");
    if (leaderboardError) {
      setError("CLARA could not load the study consistency leaderboard.");
      setEntries([]);
    } else {
      setError("");
      setEntries((data ?? []) as StudyLeaderboardEntry[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLeaderboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard]);

  const currentIndex = entries.findIndex((entry) => entry.user_id === user?.id);
  const current = currentIndex >= 0 ? entries[currentIndex] : undefined;

  return <div className="leaderboard-page">
    <header className="leaderboard-hero"><div><p className="eyebrow">LAST 7 CALENDAR DAYS</p><h1>CLARA Learning League</h1><p>Ranked by consistent learning — not marks. Scores reward active days, current streak, and up to two successful study sessions per day.</p></div><button type="button" onClick={() => void loadLeaderboard()} disabled={loading}>Refresh</button></header>
    {error && <div className="official-alert" role="alert">{error}</div>}
    {current && <section className="leaderboard-current">
      <div><span>Your rank</span><strong>#{currentIndex + 1}</strong></div>
      <div><span>Learning score</span><strong>{current.learning_score}</strong></div>
      <div><span>Active days</span><strong>{current.active_days}<small>/7</small></strong></div>
      <div><span>Current streak</span><strong>{current.current_streak}<small> days</small></strong></div>
    </section>}
    <section className="leaderboard-board">
      <div className="official-section-heading"><div><p>GLOBAL STUDENT RANKING</p><h2>Consistency leaders</h2></div><span>{entries.length}</span></div>
      {loading ? <div className="official-empty">Calculating consistency scores…</div> : entries.length === 0 ? <div className="official-empty"><strong>No study activity yet</strong><p>Successful Personal Study Workspace responses will appear here.</p></div> : <>
        <div className="leaderboard-podium">
          {entries.slice(0, 3).map((entry, index) => <article className={entry.user_id === user?.id ? "current" : ""} key={entry.user_id}>
            <span>{PODIUM_LABELS[index]}</span><div className="leaderboard-avatar">{entry.full_name.charAt(0).toUpperCase()}</div><h3>{entry.full_name}</h3><p>@{entry.username}</p><strong>{entry.learning_score}<small> pts</small></strong><footer>{entry.active_days}/7 days · {entry.current_streak} day streak · {entry.total_sessions_last_7} sessions</footer>
          </article>)}
        </div>
        {entries.length > 3 && <div className="leaderboard-list">
          {entries.slice(3).map((entry, index) => <article className={entry.user_id === user?.id ? "current" : ""} key={entry.user_id}><b>#{index + 4}</b><div className="leaderboard-avatar">{entry.full_name.charAt(0).toUpperCase()}</div><div><strong>{entry.full_name}</strong><span>@{entry.username}</span></div><span>{entry.active_days}/7 active</span><span>{entry.current_streak} day streak · {entry.total_sessions_last_7} sessions</span><em>{entry.learning_score}</em></article>)}
        </div>}
      </>}
      <p className="leaderboard-formula">Score = active days (50%) + current streak (30%) + credited sessions (20%). Quiz scores are never used.</p>
    </section>
  </div>;
}
