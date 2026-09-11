"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { useAuth } from "@/components/auth-provider";

const AUTH_ROUTES = new Set(["/login", "/signup"]);

function AuthLoading() {
  return <main className="auth-loading" aria-live="polite"><span className="brand-mark">C</span><p>Opening CLARA…</p></main>;
}

export function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, profile, user } = useAuth();
  const isLandingPage = pathname === "/";
  const isAuthRoute = AUTH_ROUTES.has(pathname);
  const isPublicRoute = isLandingPage || isAuthRoute;
  const isTeacherRoute = pathname === "/teacher" || pathname.startsWith("/teacher/");

  useEffect(() => {
    if (loading) return;
    if (!isPublicRoute && !user) router.replace("/login");
    if (isAuthRoute && user) router.replace(profile?.role === "teacher" ? "/teacher" : "/dashboard");
    if (!isPublicRoute && user && profile?.role === "teacher" && !isTeacherRoute) router.replace("/teacher");
    if (!isPublicRoute && user && profile?.role === "student" && isTeacherRoute) router.replace("/dashboard");
  }, [isAuthRoute, isPublicRoute, isTeacherRoute, loading, profile?.role, router, user]);

  if (isLandingPage) return children;

  if (
    loading
    || (!isPublicRoute && !user)
    || (isAuthRoute && user)
    || (Boolean(user) && profile?.role === "teacher" && !isPublicRoute && !isTeacherRoute)
    || (Boolean(user) && profile?.role === "student" && isTeacherRoute)
  ) return <AuthLoading />;
  if (isPublicRoute) return children;

  return <div className="app-shell"><Sidebar /><main className="main-content">{children}</main></div>;
}
