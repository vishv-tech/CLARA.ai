"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

const pillars = [
  ["01", "Teacher-Verified Knowledge", "Learn from material uploaded directly by your faculty."],
  ["02", "Official Subject Agents", "Each subject has its own focused, verified knowledge space."],
  ["03", "Official Quizzes", "Teachers create assessments grounded in their course material."],
  ["04", "College Notice Intelligence", "Find answers from official notices without searching PDFs and groups."],
  ["05", "Academic Management", "Keep your timetable, assignments and attendance together."],
  ["06", "Learning Consistency", "Build momentum through consistent study rather than marks."],
] as const;

const teacherFlow = ["Upload material", "Create official subject knowledge", "Generate assessments", "Publish institutional information"];
const studentFlow = ["Join a subject", "Learn from verified material", "Attempt official assessments", "Manage academic life", "Build learning consistency"];

export function LandingPage() {
  const { loading, profile, user } = useAuth();
  const signedIn = Boolean(user);
  const destination = profile?.role === "teacher" ? "/teacher" : "/dashboard";
  const destinationLabel = profile?.role === "teacher" ? "Open Teacher Space" : "Open Dashboard";
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there";

  return <main className="landing-page">
    <nav className="public-nav" aria-label="Public navigation">
      <Link href="/" className="public-brand" aria-label="CLARA home">
        <span>C</span><div><strong>CLARA</strong><small>College Learning Assistant</small></div>
      </Link>
      <div className="public-nav-links">
        <a href="#features">Features</a><a href="#students">For Students</a><a href="#teachers">For Teachers</a><a href="#how-it-works">How It Works</a>
      </div>
      <div className="public-nav-actions">
        {loading ? <span className="public-nav-loading">Opening your space…</span> : signedIn ? <>
          <span>Welcome, {firstName}</span><Link className="landing-button primary" href={destination}>{destinationLabel}</Link>
        </> : <><Link href="/login">Login</Link><Link className="landing-button primary" href="/signup">Get Started</Link></>}
      </div>
    </nav>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-eyebrow">ONE ACADEMIC SPACE</p>
        <h1>Your college life,<br />finally in one place.</h1>
        <p>CLARA brings your classes, attendance, assignments, teacher-verified knowledge, official quizzes, college notices and learning progress into one intelligent academic workspace.</p>
        <div className="landing-actions">
          <Link className="landing-button primary" href={signedIn ? destination : "/signup"}>{signedIn ? destinationLabel : "Get Started"}</Link>
          {!signedIn && <Link className="landing-button secondary" href="/login">Login</Link>}
          <a className="landing-text-link" href="#features">Explore CLARA <span>↓</span></a>
        </div>
        <div className="landing-trust-row"><span>Teacher verified</span><span>Official information</span><span>One calm workspace</span></div>
      </div>

      <div className="landing-preview" aria-label="CLARA product preview">
        <div className="preview-topline"><div><span className="preview-mark">C</span><strong>Academic overview</strong></div><span>Today · Friday</span></div>
        <article className="preview-class-card">
          <div><small>NEXT CLASS</small><h2>Artificial Intelligence</h2><p>10:00 AM · Room 204</p></div><span>AI</span>
        </article>
        <div className="preview-grid">
          <article><small>OFFICIAL QUIZ</small><h3>AI Unit 3 Assessment</h3><p>Medium · 5 questions</p><b>Available</b></article>
          <article><small>LEARNING STREAK</small><strong>5 <em>days</em></strong><p>Consistent this week</p></article>
        </div>
        <article className="preview-notice"><span>✓</span><div><small>COLLEGE NOTICE · OFFICIAL</small><h3>NPTEL registration closes Friday</h3><p>Based on the latest college notice</p></div></article>
      </div>
    </section>

    <section className="landing-section pillars-section" id="features">
      <div className="landing-section-heading"><p className="landing-eyebrow">THE CLARA WORKSPACE</p><h2>Everything that matters.<br />Nothing that distracts.</h2><p>Six connected tools for the way college actually works.</p></div>
      <div className="pillar-grid">{pillars.map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className="landing-section ecosystem-section" id="how-it-works">
      <div className="landing-section-heading"><p className="landing-eyebrow">ONE CONNECTED ECOSYSTEM</p><h2>Faculty knowledge in.<br />Student progress forward.</h2></div>
      <div className="flow-grid">
        <article id="teachers"><header><span>T</span><div><small>FOR FACULTY</small><h3>Teacher space</h3></div></header><ol>{teacherFlow.map((step) => <li key={step}>{step}</li>)}</ol></article>
        <div className="flow-connection"><span>VERIFIED</span><i>→</i><small>CONNECTED</small></div>
        <article id="students"><header><span>S</span><div><small>FOR LEARNERS</small><h3>Student space</h3></div></header><ol>{studentFlow.map((step) => <li key={step}>{step}</li>)}</ol></article>
      </div>
    </section>

    <section className="landing-section difference-section">
      <div><p className="landing-eyebrow">BUILT FOR COLLEGE KNOWLEDGE</p><h2>Not another generic<br />AI chatbot.</h2></div>
      <div><p>CLARA separates personal learning from official academic knowledge.</p><ul><li>Teacher material stays inside its subject.</li><li>College notices stay inside the notice space.</li><li>Official assessments remain teacher-controlled.</li></ul></div>
    </section>

    <section className="landing-final-cta">
      <p className="landing-eyebrow">YOUR COLLEGE. CONNECTED.</p><h2>Your academic day,<br />connected.</h2><p>One workspace for learning, classes, assessments and official college information.</p>
      <div className="landing-actions">{signedIn ? <Link className="landing-button light" href={destination}>{destinationLabel}</Link> : <><Link className="landing-button light" href="/signup">Create Account</Link><Link className="landing-button outline-light" href="/login">Login</Link></>}</div>
    </section>

    <footer className="landing-footer"><div><strong>CLARA</strong><span>College Learning Assistant</span></div><nav><a href="#students">Student</a><a href="#teachers">Teacher</a><Link href="/login">Login</Link></nav><small>Built for focused academic days.</small></footer>
  </main>;
}
