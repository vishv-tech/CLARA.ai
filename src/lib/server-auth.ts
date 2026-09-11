import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { ProfileRole, StudentProfile } from "@/lib/types";

type ServerAuthSuccess = {
  ok: true;
  client: SupabaseClient;
  user: User;
  profile: StudentProfile;
};

type ServerAuthFailure = {
  ok: false;
  response: Response;
};

export type ServerAuthResult = ServerAuthSuccess | ServerAuthFailure;

function authError(message: string, status: number) {
  return { ok: false as const, response: Response.json({ error: message }, { status }) };
}

export async function authenticateRequest(
  request: Request,
  requiredRole?: ProfileRole,
): Promise<ServerAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !publicKey) return authError("CLARA authentication is not configured.", 503);

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return authError("Please log in to continue.", 401);

  const client = createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return authError("Your session has expired. Please log in again.", 401);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id,username,full_name,avatar_url,role,created_at,updated_at")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile) return authError("Your CLARA profile could not be loaded.", 403);

  const typedProfile = profile as StudentProfile;
  if (requiredRole && typedProfile.role !== requiredRole) {
    return authError(
      requiredRole === "teacher"
        ? "Only teacher accounts can manage official subjects."
        : "Only student accounts can use an Official Subject Agent.",
      403,
    );
  }

  return { ok: true, client, user: userData.user, profile: typedProfile };
}
