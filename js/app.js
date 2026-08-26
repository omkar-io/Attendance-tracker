/* ==========================================================================
   THE LEDGER — subject-wise attendance tracker
   Auth + data now live in Supabase (Postgres + Auth), scoped to each user
   by Row Level Security. See supabase/schema.sql and README.md for setup.
   ========================================================================== */

const COLORS = ["#1D2B3A", "#3F7A5C", "#B23A2E", "#C98A2C", "#5A6B8C", "#7A4F7A", "#2E7A72"];

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

let state = {
  subjects: [],
  records: [],
  log: [],
  settings: { telegramToken: "", telegramChatId: "", notifyPresent: false, notifyAbsent: false, defaultPercent: 75 }
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------------- */
/* Row <-> app-state mapping                                               */
/* ---------------------------------------------------------------------- */

const mapSubject = r => ({
  id: r.id, name: r.name, requiredPercent: r.required_percent, color: r.color,
  baseAttended: r.base_attended, baseTotal: r.base_total
});
const mapRecord = r => ({ id: r.id, subjectId: r.subject_id, date: r.date, status: r.status });
const mapLog = r => ({ id: r.id, ts: new Date(r.created_at).getTime(), message: r.message, type: r.type });
const mapSettings = r => ({
  telegramToken: r.telegram_token || "", telegramChatId: r.telegram_chat_id || "",
  notifyPresent: !!r.notify_present, notifyAbsent: !!r.notify_absent, defaultPercent: r.default_percent || 75
});

/* ---------------------------------------------------------------------- */
/* Auth                                                                     */
/* ---------------------------------------------------------------------- */

let authMode = "login";

function setAuthStatus(msg, ok = false) {
  const el = document.getElementById("authStatus");
  el.textContent = msg;
  el.className = "auth-status" + (ok ? " ok" : "");
}

function wireAuthUI() {
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      authMode = tab.dataset.authtab;
      document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.getElementById("usernameRow").hidden = authMode !== "signup";
      document.getElementById("authSubmit").textContent = authMode === "signup" ? "Create account" : "Log in";
      document.getElementById("authPassword").autocomplete = authMode === "signup" ? "new-password" : "current-password";
      setAuthStatus("");
    });
  });

  document.getElementById("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const username = document.getElementById("authUsername").value.trim();
    const btn = document.getElementById("authSubmit");
    btn.disabled = true;

    if (authMode === "signup") {
      setAuthStatus("Creating your account…", true);
      try {
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { display_name: username || email.split("@")[0] } }
        });
        if (error) {
          setAuthStatus(error.message);
        } else if (data.session) {
          setAuthStatus("Account created — welcome!", true);
        } else {
          setAuthStatus("Account created. Check your email to confirm, then log in.", true);
        }
      } catch (err) {
        setAuthStatus("Could not reach Supabase: " + (err.message || "network error") + ". Check js/config.js and your connection.");
      }
    } else {
      setAuthStatus("Logging in…", true);
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) setAuthStatus(error.message);
      } catch (err) {
        setAuthStatus("Could not reach Supabase: " + (err.message || "network error") + ". Check js/config.js and your connection.");
      }
    }
    btn.disabled = false;
  });

  document.getElementById("btnLogout").addEventListener("click", async () => {
    await sb.auth.signOut();
  });
}

sb.auth.onAuthStateChange((event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    showApp();
  } else {
    currentUser = null;
    showAuth();
  }
});

function showAuth() {
  document.getElementById("authWrap").style.display = "flex";
  document.getElementById("appShell").style.display = "none";
}

async function showApp() {
  document.getElementById("authWrap").style.display = "none";
  document.getElementById("appShell").style.display = "block";
  const name = currentUser.user_metadata?.display_name || currentUser.email;
  document.getElementById("accountName").textContent = name;
  await loadAllData();
  renderAll();
}

/* ---------------------------------------------------------------------- */
/* Data loading                                                             */
/* ---------------------------------------------------------------------- */

async function loadAllData() {
  const uidVal = currentUser.id;

  const [subjectsRes, recordsRes, logRes, settingsRes] = await Promise.all([
    sb.from("subjects").select("*").eq("user_id", uidVal).order("created_at", { ascending: true }),
    sb.from("records").select("*").eq("user_id", uidVal),
    sb.from("activity_log").select("*").eq("user_id", uidVal).order("created_at", { ascending: false }).limit(500),
    sb.from("user_settings").select("*").eq("user_id", uidVal).maybeSingle()
  ]);

  if (subjectsRes.error) console.error(subjectsRes.error);
  if (recordsRes.error) console.error(recordsRes.error);
  if (logRes.error) console.error(logRes.error);
  if (settingsRes.error) console.error(settingsRes.error);

  state.subjects = (subjectsRes.data || []).map(mapSubject);
  state.records = (recordsRes.data || []).map(mapRecord);
  state.log = (logRes.data || []).map(mapLog);
  state.settings = settingsRes.data ? mapSettings(settingsRes.data) : { telegramToken: "", telegramChatId: "", notifyPresent: false, notifyAbsent: false, defaultPercent: 75 };
}

async function logActivity(message, type = "info") {
  const { data, error } = await sb.from("activity_log")
    .insert({ user_id: currentUser.id, message, type })
    .select().single();
  if (error) { console.error(error); return; }
  state.log.unshift(mapLog(data));
  state.log = state.log.slice(0, 500);
}

/* ---------------------------------------------------------------------- */
/* Stats                                                                   */
/* ---------------------------------------------------------------------- */

function subjectRecords(subjectId) { return state.records.filter(r => r.subjectId === subjectId); }

function subjectStats(subject) {
  const recs = subjectRecords(subject.id);
  const attended = (subject.baseAttended || 0) + recs.filter(r => r.status === "present").length;
  const total = (subject.baseTotal || 0) + recs.length;
  const required = (subject.requiredPercent || 75) / 100;
  const percent = total > 0 ? (attended / total) * 100 : 0;

  let canMiss = 0, mustAttend = 0;

  if (total === 0) {
    canMiss = 0;
  } else if (attended / total >= required) {
    canMiss = required > 0 ? Math.floor(attended / required - total) : Infinity;
    if (canMiss < 0 || !isFinite(canMiss)) canMiss = Math.max(canMiss, 0);
  } else if (required >= 1) {
    mustAttend = Infinity;
  } else {
    mustAttend = Math.max(0, Math.ceil((required * total - attended) / (1 - required)));
  }

  return { attended, total, percent, canMiss, mustAttend, required: required * 100 };
}

function overallStats() {
  let attended = 0, total = 0, atRisk = 0;
  state.subjects.forEach(s => {
    const st = subjectStats(s);
    attended += st.attended;
    total += st.total;
    if (st.percent < (s.requiredPercent || 75)) atRisk++;
  });
  const percent = total > 0 ? (attended / total) * 100 : 0;
  return { attended, total, percent, atRisk, subjectCount: state.subjects.length };
}

/* ---------------------------------------------------------------------- */
/* Telegram                                                                 */
/* ---------------------------------------------------------------------- */

async function sendTelegram(text) {
  const { telegramToken, telegramChatId } = state.settings;
  if (!telegramToken || !telegramChatId) return { ok: false, error: "Bot token or chat ID missing." };
  try {
    const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text, parse_mode: "HTML" })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || "Telegram rejected the request." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Network request to Telegram failed. Check your connection or ad-blocker." };
  }
}

async function notifyForMark(subject, status, date) {
  const { notifyPresent, notifyAbsent } = state.settings;
  if (status === "present" && !notifyPresent) return;
  if (status === "absent" && !notifyAbsent) return;
  const st = subjectStats(subject);
  const verb = status === "present" ? "✅ Present" : "❌ Absent";
  const text = `<b>${escapeHtml(subject.name)}</b>\n${verb} on ${date}\nAttendance: ${st.percent.toFixed(1)}% (${st.attended}/${st.total})`;
  const result = await sendTelegram(text);
  if (result.ok) await logActivity(`Telegram notified for ${subject.name} (${status}, ${date}).`, "telegram");
  else await logActivity(`Telegram message failed for ${subject.name}: ${result.error}`, "telegram");
  renderLog();
}

/* ---------------------------------------------------------------------- */
/* Rendering — Dashboard                                                    */
/* ---------------------------------------------------------------------- */

function renderSummary() {
  const s = overallStats();
  document.getElementById("ledgerSummary").innerHTML = `
    <div class="ledger-stat"><div class="num">${s.subjectCount}</div><div class="label">Subjects tracked</div></div>
    <div class="ledger-stat"><div class="num">${s.attended}/${s.total}</div><div class="label">Classes attended</div></div>
    <div class="ledger-stat ${s.percent < 75 ? "warn" : "good"}"><div class="num">${s.total ? s.percent.toFixed(1) : "—"}%</div><div class="label">Overall attendance</div></div>
    <div class="ledger-stat ${s.atRisk > 0 ? "warn" : "good"}"><div class="num">${s.atRisk}</div><div class="label">Subjects below target</div></div>
  `;
}

function gaugeSVG(percent, color) {
  const r = 30, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = c - (pct / 100) * c;
  return `<svg viewBox="0 0 74 74" width="74" height="74">
    <circle cx="37" cy="37" r="${r}" fill="none" stroke="#E4DECF" stroke-width="7"/>
    <circle cx="37" cy="37" r="${r}" fill="none" stroke="${color}" stroke-width="7"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 37 37)"/>
  </svg>`;
}

function renderSubjects() {
  const grid = document.getElementById("subjectGrid");
  const empty = document.getElementById("emptyState");
  if (state.subjects.length === 0) { grid.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;

  grid.innerHTML = state.subjects.map(subject => {
    const st = subjectStats(subject);
    const gaugeColor = st.percent >= subject.requiredPercent ? "#3F7A5C" : "#B23A2E";
    let marginHtml;
    if (st.total === 0) {
      marginHtml = `<div class="margin-line">No classes logged yet.</div>`;
    } else if (st.percent >= subject.requiredPercent) {
      const n = isFinite(st.canMiss) ? st.canMiss : "∞";
      marginHtml = `<div class="margin-line can-miss">You can miss <b>${n}</b> more class${n === 1 ? "" : "es"} and stay at ${subject.requiredPercent}%+.</div>`;
    } else {
      const n = isFinite(st.mustAttend) ? st.mustAttend : "∞";
      marginHtml = `<div class="margin-line must-attend">Attend the next <b>${n}</b> class${n === 1 ? "" : "es"} in a row to reach ${subject.requiredPercent}%.</div>`;
    }
    return `
    <div class="subject-card" style="--card-color:${subject.color}">
      <div class="subject-card-top">
        <div><h3>${escapeHtml(subject.name)}</h3><div class="subject-sub">Target ${subject.requiredPercent}%</div></div>
        <div class="subject-card-actions">
          <button class="icon-mini" title="Edit" data-action="edit" data-id="${subject.id}">✎</button>
          <button class="icon-mini" title="Delete" data-action="delete" data-id="${subject.id}">🗑</button>
        </div>
      </div>
      <div class="gauge-row">
        <div class="gauge">${gaugeSVG(st.percent, gaugeColor)}</div>
        <div class="gauge-text">
          <div class="gauge-percent" style="color:${gaugeColor}">${st.total ? st.percent.toFixed(1) : "0.0"}%</div>
          <div class="gauge-target">of ${subject.requiredPercent}% required</div>
        </div>
      </div>
      ${marginHtml}
      <div class="subject-counts">
        <span>Present: ${st.attended}</span><span>Total: ${st.total}</span><span>Absent: ${st.total - st.attended}</span>
      </div>
      <div class="subject-card-footer">
        <button class="btn btn-primary" data-action="mark" data-id="${subject.id}">Mark today</button>
      </div>
    </div>`;
  }).join("");
}

/* ---------------------------------------------------------------------- */
/* Rendering — Calendar                                                     */
/* ---------------------------------------------------------------------- */

let calState = { year: new Date().getFullYear(), month: new Date().getMonth(), subjectId: "all" };

function populateCalendarSubjectSelect() {
  const sel = document.getElementById("calSubjectSelect");
  const current = sel.value || "all";
  sel.innerHTML = `<option value="all">All subjects</option>` +
    state.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  calState.subjectId = sel.value;
}

function renderWeekdayHeader() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  document.getElementById("calendarWeekdays").innerHTML = days.map(d => `<div class="weekday-label">${d}</div>`).join("");
}

function dayStatusFor(dateStr) {
  const relevantSubjects = calState.subjectId === "all" ? state.subjects.map(s => s.id) : [calState.subjectId];
  const recs = state.records.filter(r => relevantSubjects.includes(r.subjectId) && r.date === dateStr);
  if (recs.length === 0) return "none";
  const hasPresent = recs.some(r => r.status === "present");
  const hasAbsent = recs.some(r => r.status === "absent");
  if (hasPresent && hasAbsent) return "mixed";
  return hasPresent ? "present" : "absent";
}

function renderCalendar() {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  document.getElementById("calLabel").textContent = `${monthNames[calState.month]} ${calState.year}`;

  const firstDay = new Date(calState.year, calState.month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(calState.year, calState.month + 1, 0).getDate();
  const today = todayISO();

  let cells = "";
  for (let i = 0; i < startOffset; i++) cells += `<div class="day-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calState.year}-${String(calState.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const status = dayStatusFor(dateStr);
    const isToday = dateStr === today ? "today" : "";
    cells += `<div class="day-cell ${status} ${isToday}" data-date="${dateStr}" title="Click to mark attendance">${d}</div>`;
  }
  document.getElementById("calendarGrid").innerHTML = cells;
}

/* ---------------------------------------------------------------------- */
/* Rendering — Activity Log / Settings                                      */
/* ---------------------------------------------------------------------- */

function renderLog() {
  const list = document.getElementById("logList");
  const empty = document.getElementById("logEmpty");
  if (state.log.length === 0) { list.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = state.log.map(item => {
    const dt = new Date(item.ts);
    const timeStr = dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `<li class="log-item type-${item.type}"><span class="log-time">${timeStr}</span><span class="log-msg">${escapeHtml(item.message)}</span></li>`;
  }).join("");
}

function renderSettings() {
  document.getElementById("tgToken").value = state.settings.telegramToken || "";
  document.getElementById("tgChatId").value = state.settings.telegramChatId || "";
  document.getElementById("tgEnabled").checked = !!state.settings.notifyPresent;
  document.getElementById("tgEnabledAbsent").checked = !!state.settings.notifyAbsent;
  document.getElementById("defaultPercent").value = state.settings.defaultPercent || 75;
}

/* ---------------------------------------------------------------------- */
/* Tabs                                                                     */
/* ---------------------------------------------------------------------- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "calendar") { populateCalendarSubjectSelect(); renderWeekdayHeader(); renderCalendar(); }
  if (name === "log") renderLog();
  if (name === "settings") renderSettings();
}

/* ---------------------------------------------------------------------- */
/* Modals & mutations                                                       */
/* ---------------------------------------------------------------------- */

let editingSubjectId = null;
let markingSubjectId = null;

function openSubjectModal(subjectId = null) {
  editingSubjectId = subjectId;
  const backdrop = document.getElementById("subjectModalBackdrop");
  const title = document.getElementById("subjectModalTitle");
  const swatchWrap = document.getElementById("colorSwatches");
  swatchWrap.innerHTML = COLORS.map(c => `<div class="swatch" data-color="${c}" style="background:${c}"></div>`).join("");

  if (subjectId) {
    const s = state.subjects.find(x => x.id === subjectId);
    title.textContent = "Edit subject";
    document.getElementById("subjectName").value = s.name;
    document.getElementById("subjectPercent").value = s.requiredPercent;
    document.getElementById("subjectAttended").value = s.baseAttended || "";
    document.getElementById("subjectTotal").value = s.baseTotal || "";
    [...swatchWrap.children].forEach(sw => sw.classList.toggle("selected", sw.dataset.color === s.color));
  } else {
    title.textContent = "Add subject";
    document.getElementById("subjectName").value = "";
    document.getElementById("subjectPercent").value = state.settings.defaultPercent || 75;
    document.getElementById("subjectAttended").value = "";
    document.getElementById("subjectTotal").value = "";
    const pick = COLORS[state.subjects.length % COLORS.length];
    [...swatchWrap.children].forEach(sw => sw.classList.toggle("selected", sw.dataset.color === pick));
  }
  backdrop.classList.add("open");
  document.getElementById("subjectName").focus();
}

function closeSubjectModal() {
  document.getElementById("subjectModalBackdrop").classList.remove("open");
  editingSubjectId = null;
}

async function saveSubjectFromModal() {
  const name = document.getElementById("subjectName").value.trim();
  const percent = Number(document.getElementById("subjectPercent").value) || 75;
  const attended = Number(document.getElementById("subjectAttended").value) || 0;
  const total = Number(document.getElementById("subjectTotal").value) || 0;
  const selectedSwatch = document.querySelector("#colorSwatches .swatch.selected");
  const color = selectedSwatch ? selectedSwatch.dataset.color : COLORS[0];

  if (!name) { toast("Give the subject a name first."); return; }
  if (total && attended > total) { toast("Attended can't be more than total classes."); return; }

  const btn = document.getElementById("btnSaveSubject");
  btn.disabled = true;

  if (editingSubjectId) {
    const { error } = await sb.from("subjects").update({
      name, required_percent: percent, color, base_attended: attended, base_total: total
    }).eq("id", editingSubjectId);
    if (error) { toast("Could not save: " + error.message); btn.disabled = false; return; }
    const s = state.subjects.find(x => x.id === editingSubjectId);
    Object.assign(s, { name, requiredPercent: percent, color, baseAttended: attended, baseTotal: total });
    await logActivity(`Edited subject "${name}".`, "info");
  } else {
    const { data, error } = await sb.from("subjects").insert({
      user_id: currentUser.id, name, required_percent: percent, color, base_attended: attended, base_total: total
    }).select().single();
    if (error) { toast("Could not save: " + error.message); btn.disabled = false; return; }
    state.subjects.push(mapSubject(data));
    await logActivity(`Added subject "${name}" (target ${percent}%).`, "info");
  }
  btn.disabled = false;
  closeSubjectModal();
  renderSummary(); renderSubjects();
}

async function deleteSubject(id) {
  const s = state.subjects.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`Delete "${s.name}" and all its attendance records? This can't be undone.`)) return;
  const { error } = await sb.from("subjects").delete().eq("id", id);
  if (error) { toast("Could not delete: " + error.message); return; }
  state.subjects = state.subjects.filter(x => x.id !== id);
  state.records = state.records.filter(r => r.subjectId !== id);
  await logActivity(`Deleted subject "${s.name}".`, "info");
  renderSummary(); renderSubjects();
}

function openMarkModal(subjectId, presetDate = null) {
  markingSubjectId = subjectId;
  const s = state.subjects.find(x => x.id === subjectId);
  document.getElementById("markModalTitle").textContent = `Mark attendance — ${s.name}`;
  document.getElementById("markDate").value = presetDate || todayISO();
  document.getElementById("markModalBackdrop").classList.add("open");
}

function closeMarkModal() {
  document.getElementById("markModalBackdrop").classList.remove("open");
  markingSubjectId = null;
}

async function markAttendance(status) {
  const subject = state.subjects.find(x => x.id === markingSubjectId);
  if (!subject) return;
  const date = document.getElementById("markDate").value || todayISO();

  const { data, error } = await sb.from("records")
    .insert({ user_id: currentUser.id, subject_id: subject.id, date, status })
    .select().single();
  if (error) { toast("Could not save: " + error.message); return; }

  state.records.push(mapRecord(data));
  await logActivity(`Marked ${status === "present" ? "Present ✅" : "Absent ❌"} for "${subject.name}" on ${date}.`, status);
  renderSummary(); renderSubjects();
  toast(`Marked ${status} for ${subject.name}`);
  closeMarkModal();
  notifyForMark(subject, status, date);
}

function handleCalendarDayClick(dateStr) {
  if (state.subjects.length === 0) { toast("Add a subject first."); return; }
  if (calState.subjectId === "all") {
    if (state.subjects.length === 1) openMarkModal(state.subjects[0].id, dateStr);
    else toast("Pick a specific subject from the dropdown to mark a day.");
    return;
  }
  openMarkModal(calState.subjectId, dateStr);
}

/* ---------------------------------------------------------------------- */
/* Settings mutations                                                       */
/* ---------------------------------------------------------------------- */

async function saveTelegramSettings() {
  const telegram_token = document.getElementById("tgToken").value.trim();
  const telegram_chat_id = document.getElementById("tgChatId").value.trim();
  const notify_present = document.getElementById("tgEnabled").checked;
  const notify_absent = document.getElementById("tgEnabledAbsent").checked;

  const { error } = await sb.from("user_settings").upsert({
    user_id: currentUser.id, telegram_token, telegram_chat_id,
    notify_present, notify_absent, default_percent: state.settings.defaultPercent,
    updated_at: new Date().toISOString()
  });
  if (error) { setTgStatus(error.message, false); return; }

  state.settings.telegramToken = telegram_token;
  state.settings.telegramChatId = telegram_chat_id;
  state.settings.notifyPresent = notify_present;
  state.settings.notifyAbsent = notify_absent;
  await logActivity("Updated Telegram notification settings.", "info");
  setTgStatus("Settings saved.", true);
}

async function saveDefaultPercent() {
  const value = Number(document.getElementById("defaultPercent").value) || 75;
  const { error } = await sb.from("user_settings").upsert({
    user_id: currentUser.id,
    telegram_token: state.settings.telegramToken,
    telegram_chat_id: state.settings.telegramChatId,
    notify_present: state.settings.notifyPresent,
    notify_absent: state.settings.notifyAbsent,
    default_percent: value,
    updated_at: new Date().toISOString()
  });
  if (error) { toast("Could not save: " + error.message); return; }
  state.settings.defaultPercent = value;
  toast("Default target saved.");
}

async function resetAllData() {
  if (!confirm("This deletes every subject, record, and log entry for your account. Continue?")) return;
  if (!confirm("Really sure? There is no undo.")) return;
  const uidVal = currentUser.id;
  await Promise.all([
    sb.from("records").delete().eq("user_id", uidVal),
    sb.from("activity_log").delete().eq("user_id", uidVal),
    sb.from("subjects").delete().eq("user_id", uidVal)
  ]);
  state.subjects = []; state.records = []; state.log = [];
  renderAll();
  toast("All data erased.");
}

async function clearLog() {
  if (state.log.length === 0) return;
  if (!confirm("Clear the entire activity log?")) return;
  const { error } = await sb.from("activity_log").delete().eq("user_id", currentUser.id);
  if (error) { toast("Could not clear log: " + error.message); return; }
  state.log = [];
  renderLog();
}

/* ---------------------------------------------------------------------- */
/* Toast                                                                    */
/* ---------------------------------------------------------------------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function setTgStatus(msg, ok) {
  const el = document.getElementById("tgStatus");
  el.textContent = msg;
  el.className = "settings-status " + (ok ? "ok" : "err");
}

/* ---------------------------------------------------------------------- */
/* Event wiring                                                             */
/* ---------------------------------------------------------------------- */

function wireEvents() {
  document.getElementById("tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });

  document.getElementById("btnAddSubject").addEventListener("click", () => openSubjectModal());
  document.getElementById("btnAddSubjectEmpty").addEventListener("click", () => openSubjectModal());
  document.getElementById("btnCancelSubject").addEventListener("click", closeSubjectModal);
  document.getElementById("btnSaveSubject").addEventListener("click", saveSubjectFromModal);
  document.getElementById("subjectModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "subjectModalBackdrop") closeSubjectModal();
  });
  document.getElementById("colorSwatches").addEventListener("click", e => {
    const sw = e.target.closest(".swatch");
    if (!sw) return;
    document.querySelectorAll("#colorSwatches .swatch").forEach(s => s.classList.remove("selected"));
    sw.classList.add("selected");
  });

  document.getElementById("subjectGrid").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "edit") openSubjectModal(id);
    if (btn.dataset.action === "delete") deleteSubject(id);
    if (btn.dataset.action === "mark") openMarkModal(id);
  });

  document.getElementById("btnCancelMark").addEventListener("click", closeMarkModal);
  document.getElementById("markModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "markModalBackdrop") closeMarkModal();
  });
  document.getElementById("markPresentBtn").addEventListener("click", () => markAttendance("present"));
  document.getElementById("markAbsentBtn").addEventListener("click", () => markAttendance("absent"));

  document.getElementById("calSubjectSelect").addEventListener("change", e => {
    calState.subjectId = e.target.value;
    renderCalendar();
  });
  document.getElementById("calPrev").addEventListener("click", () => {
    calState.month--; if (calState.month < 0) { calState.month = 11; calState.year--; }
    renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", () => {
    calState.month++; if (calState.month > 11) { calState.month = 0; calState.year++; }
    renderCalendar();
  });
  document.getElementById("calendarGrid").addEventListener("click", e => {
    const cell = e.target.closest(".day-cell");
    if (!cell || cell.classList.contains("empty")) return;
    handleCalendarDayClick(cell.dataset.date);
  });

  document.getElementById("btnClearLog").addEventListener("click", clearLog);
  document.getElementById("btnSaveTelegram").addEventListener("click", saveTelegramSettings);
  document.getElementById("btnTestTelegram").addEventListener("click", async () => {
    state.settings.telegramToken = document.getElementById("tgToken").value.trim();
    state.settings.telegramChatId = document.getElementById("tgChatId").value.trim();
    setTgStatus("Sending…", true);
    const result = await sendTelegram("🔔 Test message from The Ledger — your bot is connected.");
    if (result.ok) { setTgStatus("Test message sent — check Telegram.", true); await logActivity("Sent a Telegram test message.", "telegram"); }
    else setTgStatus(result.error, false);
  });
  document.getElementById("btnSaveDefault").addEventListener("click", saveDefaultPercent);
  document.getElementById("btnResetAll").addEventListener("click", resetAllData);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeSubjectModal(); closeMarkModal(); }
  });
}

/* ---------------------------------------------------------------------- */
/* Boot                                                                     */
/* ---------------------------------------------------------------------- */

function renderAll() {
  renderSummary();
  renderSubjects();
  populateCalendarSubjectSelect();
  renderWeekdayHeader();
  renderCalendar();
  renderLog();
  renderSettings();
}

document.addEventListener("DOMContentLoaded", () => {
  wireAuthUI();
  wireEvents();
});