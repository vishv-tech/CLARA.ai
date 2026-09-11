"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { ProfileRole, StudentProfile } from "@/lib/types";

type AuthResult = { error?: string; requiresEmailConfirmation?: boolean };

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: StudentProfile | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: { fullName: string; username: string; email: string; password: string; role: ProfileRole }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (normalized.includes("email not confirmed")) return "Confirm your email before logging in.";
  if (normalized.includes("user already registered")) return "An account with this email already exists.";
  if (normalized.includes("database error saving new user") || normalized.includes("duplicate key")) {
    return "That username may already be taken. Try another one.";
  }
  if (normalized.includes("password")) return "Use a password with at least 6 characters.";
  return message || "CLARA could not complete that request. Please try again.";
}

async function fetchProfile(user: User): Promise<StudentProfile> {
  const fallback: StudentProfile = {
    id: user.id,
    username: String(user.user_metadata.username ?? user.email?.split("@")[0] ?? "student"),
    full_name: String(user.user_metadata.full_name ?? "CLARA Student"),
    avatar_url: null,
    role: "student",
    created_at: user.created_at,
    updated_at: user.updated_at ?? user.created_at,
  };
  if (!supabase) return fallback;
  const { data, error } = await supabase.from("profiles").select("id, username, full_name, avatar_url, role, created_at, updated_at").eq("id", user.id).maybeSingle();
  if (error || !data) return fallback;
  return data as StudentProfile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);

  useEffect(() => {
    let active = true;
    if (!supabase) return;

    async function resolveSession(nextSession: Session | null) {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const nextProfile = await fetchProfile(nextSession.user);
      if (!active) return;
      setProfile(nextProfile);
      setLoading(false);
    }

    void supabase.auth.getSession()
      .then(({ data }) => resolveSession(data.session))
      .catch(() => resolveSession(null));
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "INITIAL_SESSION") return;
      window.setTimeout(() => void resolveSession(nextSession), 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user,
    profile,
    signIn: async (email, password) => {
      if (!supabase) return { error: "CLARA authentication is not configured yet." };
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: friendlyAuthError(error.message) };
      setSession(data.session);
      setUser(data.user);
      setProfile(await fetchProfile(data.user));
      return {};
    },
    signUp: async ({ fullName, username, email, password, role }) => {
      if (!supabase) return { error: "CLARA authentication is not configured yet." };
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, username, role: role === "teacher" ? "teacher" : "student" } },
      });
      if (error) return { error: friendlyAuthError(error.message) };
      if (!data.session) return { requiresEmailConfirmation: true };
      setSession(data.session);
      setUser(data.user);
      setProfile(data.user ? await fetchProfile(data.user) : null);
      return {};
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
    },
  }), [loading, profile, session, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
