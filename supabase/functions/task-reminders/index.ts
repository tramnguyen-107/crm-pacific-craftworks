// Daily (8 AM Hawaii): creates "due soon" / "overdue" notifications for open, assigned tasks.
// Each new notification row triggers its own email via notify-email.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hawaiiDate = (d = new Date()) => new Date(d.getTime() - 10 * 3600 * 1000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "edge_secret").single();
  if (!sec || req.headers.get("x-pcw-secret") !== sec.value) return json({ error: "Unauthorized" }, 401);

  const today = hawaiiDate();
  const tomorrow = hawaiiDate(new Date(Date.now() + 24 * 3600 * 1000));
  const { data: tasks } = await db.from("order_tasks").select("id, title, due_date, order_id, assignee_id")
    .neq("status", "done").not("assignee_id", "is", null).not("due_date", "is", null).lte("due_date", tomorrow);

  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  let created = 0;
  for (const t of tasks ?? []) {
    const type = t.due_date < today ? "overdue" : "due_soon";
    const { count } = await db.from("notifications").select("id", { count: "exact", head: true })
      .eq("task_id", t.id).eq("type", type).gte("created_at", since);
    if (count) continue;
    const title = type === "overdue" ? `Overdue (due ${t.due_date}): ${t.title}`
      : t.due_date === today ? `Due today: ${t.title}` : `Due tomorrow: ${t.title}`;
    await db.from("notifications").insert({ member_id: t.assignee_id, type, task_id: t.id, order_id: t.order_id, title });
    created++;
  }
  return json({ ok: true, checked: tasks?.length ?? 0, created });
});
