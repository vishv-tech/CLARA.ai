"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { ProfileRole } from "@/lib/types";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { configured, signIn, signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<ProfileRole>("student");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const isSignup = mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!configured) return setError("CLARA authentication is not configured yet.");
    if (isSignup && !fullName.trim()) return setError("Enter your full name.");
    if (isSignup && !/^[a-z0-9_]{3,20}$/.test(username)) {
      return setError("Username must be 3–20 lowercase letters, numbers, or underscores.");
    }
    if (password.length < 6) return setError("Use a password with at least 6 characters.");

    setSubmitting(true);
    const result = isSignup
      ? await signUp({ fullName: fullName.trim(), username, email: email.trim(), password, role })
      : await signIn(email.trim(), password);
    setSubmitting(false);
    if (result.error) return setError(result.error);
    if (result.requiresEmailConfirmation) return setConfirmationSent(true);
    router.replace(role === "teacher" ? "/teacher" : "/dashboard");
  }

  if (confirmationSent) {
    return <main className="auth-page"><section className="auth-card auth-confirmation">
      <span className="auth-success">✓</span><p className="eyebrow">ACCOUNT CREATED</p>
      <h1>Check your email</h1><p>Confirm your CLARA account, then come back to log in.</p>
      <Link href="/login" className="auth-primary-link">Go to Login</Link>
    </section></main>;
  }

  return <main className="auth-page"><section className="auth-card">
    <Link href="/" className="auth-brand" aria-label="CLARA home">
      <span className="brand-mark">C</span><span><strong>CLARA</strong><small>COLLEGE LEARNING AND RESOURCE ASSISTANT</small></span>
    </Link>
    <div className="auth-heading">
      <p className="eyebrow">{isSignup ? "CREATE YOUR CLARA ID" : "WELCOME BACK"}</p>
      <h1>{isSignup ? "Start learning with CLARA" : "Continue your academic day"}</h1>
      <p>{isSignup ? "One account for your focused learning journey." : "Log in to open your student workspace."}</p>
    </div>
    {!configured && <div className="auth-config-warning"><strong>CLARA authentication is not configured yet.</strong><span>Add the Supabase public variables to .env.local and restart the server.</span></div>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <form className="auth-form" onSubmit={handleSubmit}>
      {isSignup && <label>Full Name<input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Vishv Lange" /></label>}
      {isSignup && <label>Username<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))} maxLength={20} placeholder="vishv" /><small>3–20 lowercase letters, numbers, or underscores</small></label>}
      {isSignup && <fieldset className="auth-role-field">
        <legend>I am a</legend>
        <div>
          <button type="button" className={role === "student" ? "active" : ""} onClick={() => setRole("student")}>
            <strong>Student</strong><small>Join official subjects and learn</small>
          </button>
          <button type="button" className={role === "teacher" ? "active" : ""} onClick={() => setRole("teacher")}>
            <strong>Teacher</strong><small>Create verified subject spaces</small>
          </button>
        </div>
      </fieldset>}
      <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input required type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} placeholder="At least 6 characters" /></label>
      <button type="submit" disabled={submitting || !configured}>{submitting ? "Please wait…" : isSignup ? "Create Account" : "Login"}</button>
    </form>
    <p className="auth-switch">{isSignup ? "Already have an account?" : "Don’t have an account?"} {isSignup ? <Link href="/login">Login</Link> : <Link href="/signup">Create account</Link>}</p>
  </section></main>;
}
