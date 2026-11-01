/* Ledger extras: PWA, phone reminders, dark mode, timezone-safe dates. Loads after app.js. */

// Fix: toISOString() is UTC, so before 5:30am IST "today" was yesterday.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Theme
const savedTheme = localStorage.getItem("ledger-theme") ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.documentElement.dataset.theme = savedTheme;

// Service worker (needed for install + push)
let swReg = null;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r => swReg = r).catch(console.error);

const isIOS = /iphone|ipad/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function b64ToBytes(s) {
  const p = "=".repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function enablePush() {
  if (typeof VAPID_PUBLIC_KEY === "undefined" || !VAPID_PUBLIC_KEY) return rStatus("Add your VAPID public key to js/config.js first.", false);
  if (isIOS && !isStandalone) return rStatus("On iPhone: Share → Add to Home Screen, then open the app from there.", false);
  if (!("PushManager" in window)) return rStatus("This browser doesn't support push notifications.", false);
  if (await Notification.requestPermission() !== "granted") return rStatus("Notifications are blocked. Allow them in your browser or phone settings.", false);
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert(
    { user_id: currentUser.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  if (error) return rStatus(error.message, false);
  await reg.showNotification("The Ledger", { body: "This device will now get attendance reminders.", icon: "icons/icon-192.png" });
  rStatus("This device is registered for reminders.", true);
}

function rStatus(msg, ok) {
  const el = document.getElementById("rmStatus");
  el.textContent = msg; el.className = "settings-status " + (ok ? "ok" : "err");
}

async function loadReminder() {
  const { data } = await sb.from("user_settings").select("reminder_enabled,reminder_time,reminder_telegram").eq("user_id", currentUser.id).maybeSingle();
  if (!data) return;
  document.getElementById("rmOn").checked = data.reminder_enabled;
  document.getElementById("rmTime").value = (data.reminder_time || "18:00").slice(0, 5);
  document.getElementById("rmTg").checked = data.reminder_telegram;
}

async function saveReminder() {
  const { error } = await sb.from("user_settings").upsert({
    user_id: currentUser.id,
    reminder_enabled: document.getElementById("rmOn").checked,
    reminder_time: document.getElementById("rmTime").value || "18:00",
    reminder_telegram: document.getElementById("rmTg").checked,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    last_reminded_on: null,
    updated_at: new Date().toISOString()
  });
  if (error) return rStatus(error.message, false);
  rStatus("Reminder saved. You'll be nudged only if something is unmarked.", true);
}

document.addEventListener("DOMContentLoaded", () => {
  // Theme toggle
  const tb = document.createElement("button");
  tb.className = "theme-btn"; tb.setAttribute("aria-label", "Toggle dark mode");
  const paint = () => tb.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
  tb.onclick = () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; localStorage.setItem("ledger-theme", t); paint();
  };
  paint(); document.querySelector(".account-chip").prepend(tb);

  // Reminder card
  const card = document.createElement("div");
  card.className = "settings-card";
  card.innerHTML = `
    <h3>Phone reminders</h3>
    <p class="settings-copy">A daily nudge on your phone if you haven't marked today's classes. Nothing is sent once you've marked everything.</p>
    ${isIOS && !isStandalone ? `<p class="install-hint">iPhone: tap Share → Add to Home Screen, then open The Ledger from your home screen to enable reminders.</p>` : ""}
    <div class="field-row checkbox-row"><label><input type="checkbox" id="rmOn"> Remind me every day</label></div>
    <div class="field-row"><label for="rmTime">Remind me at</label><input type="time" id="rmTime" value="18:00"></div>
    <div class="field-row checkbox-row"><label><input type="checkbox" id="rmTg"> Also send the reminder to Telegram</label></div>
    <div class="settings-actions">
      <button class="btn btn-primary" id="rmSave">Save reminder</button>
      <button class="btn btn-ghost" id="rmPush">Enable on this device</button>
    </div>
    <p class="settings-status" id="rmStatus"></p>`;
  document.querySelector("#view-settings .settings-card").before(card);
  document.getElementById("rmSave").onclick = saveReminder;
  document.getElementById("rmPush").onclick = enablePush;

  // Copy fixes (these described the old browser-only storage)
  const note = document.querySelector(".settings-note");
  if (note) note.textContent = "Your token is stored in your own Supabase project, protected by row-level security so only your account can read it.";
  const reset = document.querySelector(".settings-card.danger .settings-copy");
  if (reset) reset.textContent = "Deletes all subjects, records, and logs from your account. This cannot be undone.";

  // Load saved reminder values when Settings opens
  const orig = renderSettings;
  renderSettings = function () { orig(); if (currentUser) loadReminder(); };
});
