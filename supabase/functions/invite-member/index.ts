// Invite a team member to the CRM (admins only).
// The invitee gets an email from Supabase Auth, clicks the link and sets their own password.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller must be a signed-in admin
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr || !isAdmin) return json({ error: "Only admins can invite members." }, 403);

  let body: { email?: string; redirectTo?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Invalid email." }, 400);

  const admin = createClient(url, serviceKey);

  // Only emails already listed on a team member can be invited
  const { data: members, error: mErr } = await admin.from("team_members").select("emails");
  if (mErr) return json({ error: mErr.message }, 500);
  const known = (members ?? []).some((m: { emails: string[] }) =>
    (m.emails ?? []).some((e) => e.toLowerCase() === email));
  if (!known) return json({ error: "Add this email to a team member first." }, 400);

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo || undefined,
  });
  if (error) {
    const already = /already been registered|already registered|exists/i.test(error.message);
    return json({ error: already ? "This email already has an account." : error.message }, already ? 409 : 400);
  }
  return json({ ok: true });
});
