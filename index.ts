import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const force = (await req.json().catch(() => ({}))).force === true; // {"force":true} skips the time check (for testing)
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  const { data: users } = await db.from("user_settings").select("*").eq("reminder_enabled", true);
  let sent = 0;
  for (const u of users ?? []) {
    const tz = u.timezone || "Asia/Kolkata", now = new Date();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    if (!force && (hm < u.reminder_time.slice(0, 5) || u.last_reminded_on === day)) continue;

    const [{ data: subs }, { data: recs }] = await Promise.all([
      db.from("subjects").select("id,name").eq("user_id", u.user_id),
      db.from("records").select("subject_id").eq("user_id", u.user_id).eq("date", day),
    ]);
    const done = new Set((recs ?? []).map((r) => r.subject_id));
    const pending = (subs ?? []).filter((s) => !done.has(s.id));
    await db.from("user_settings").update({ last_reminded_on: day }).eq("user_id", u.user_id);
    if (!pending.length) continue;

    const body = `Not marked yet: ${pending.map((s) => s.name).join(", ")}`;
    const { data: devices } = await db.from("push_subscriptions").select("*").eq("user_id", u.user_id);
    for (const d of devices ?? []) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ title: "Mark today's attendance", body }));
        sent++;
      } catch (e) { if ([404, 410].includes(e.statusCode)) await db.from("push_subscriptions").delete().eq("id", d.id); }
    }
    if (u.reminder_telegram && u.telegram_token && u.telegram_chat_id)
      await fetch(`https://api.telegram.org/bot${u.telegram_token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.telegram_chat_id, text: "🔔 " + body }) });
  }
  return Response.json({ sent });
});
