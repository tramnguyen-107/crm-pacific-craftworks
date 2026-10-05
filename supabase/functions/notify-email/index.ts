// Sends the email for one notification row (called by a database trigger).
// Needs the RESEND_API_KEY secret; without it the email is skipped (the in-app bell still works).
import { createClient } from "npm:@supabase/supabase-js@2";

const CRM_URL = Deno.env.get("CRM_URL") ?? "https://crm-pacific-craftworks.vercel.app";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Pacific Craftworks CRM <crm@pacificcraftworks.com>";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// notification type → preference column
const PREF: Record<string, string> = {
  assigned: "email_assigned", mentioned: "email_mentioned", comment: "email_mentioned",
  due_soon: "email_due", overdue: "email_due", completed: "email_completed",
};

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "edge_secret").single();
  if (!sec || req.headers.get("x-pcw-secret") !== sec.value) return json({ error: "Unauthorized" }, 401);

  const { notification_id } = await req.json().catch(() => ({}));
  if (!notification_id) return json({ error: "notification_id required" }, 400);

  const { data: n } = await db.from("notifications").select("*").eq("id", notification_id).single();
  if (!n || n.emailed_at) return json({ skipped: "missing or already emailed" });

  const [{ data: member }, { data: prefs }, { data: actor }, { data: task }] = await Promise.all([
    db.from("team_members").select("name, emails").eq("id", n.member_id).single(),
    db.from("notification_prefs").select("*").eq("member_id", n.member_id).maybeSingle(),
    n.actor_id ? db.from("team_members").select("name").eq("id", n.actor_id).single() : Promise.resolve({ data: null }),
    n.task_id ? db.from("order_tasks").select("id, title, due_date, status, order_id, description").eq("id", n.task_id).single() : Promise.resolve({ data: null }),
  ]);
  const prefKey = PREF[n.type];
  const defaults: Record<string, boolean> = { email_assigned: true, email_mentioned: true, email_due: true, email_completed: false };
  const wants = prefKey ? (prefs ? prefs[prefKey] : defaults[prefKey]) : false;
  if (!wants) return json({ skipped: "preference off" });
  if (!member?.emails?.length) return json({ skipped: "no email" });

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ skipped: "RESEND_API_KEY not set" });

  const link = task ? `${CRM_URL}/?task=${task.id}` : `${CRM_URL}/?view=notifications`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#191919">
    <p style="font-size:13px;color:#787774;margin:0 0 6px">Pacific Craftworks CRM</p>
    <h2 style="font-size:20px;margin:0 0 12px">${esc(n.title)}</h2>
    ${n.body ? `<div style="font-size:14px;line-height:1.5;background:#F7F7F5;border-radius:8px;padding:12px 14px;margin:0 0 14px;white-space:pre-wrap">${esc(n.body)}</div>` : ""}
    ${task ? `<p style="font-size:14px;margin:0 0 4px"><b>Task:</b> ${esc(task.title)}</p>
      ${task.due_date ? `<p style="font-size:14px;margin:0 0 4px"><b>Due:</b> ${esc(task.due_date)}</p>` : ""}
      ${task.order_id ? `<p style="font-size:14px;margin:0 0 4px"><b>Order:</b> ${esc(task.order_id)}</p>` : ""}` : ""}
    <p style="margin:18px 0"><a href="${link}" style="background:#191919;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600">Open in CRM</a></p>
    <p style="font-size:12px;color:#787774">${actor?.name ? `From ${esc(actor.name)} · ` : ""}You can change email settings in CRM → Settings → Notifications.</p>
  </div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: member.emails, subject: n.title, html }),
  });
  if (!r.ok) return json({ error: "Resend: " + (await r.text()) }, 502);
  await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
  return json({ ok: true });
});
