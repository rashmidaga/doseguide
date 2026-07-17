/* ============================================================
   DoseGuide, application logic
   Two experiences over one dose engine:
     · Patient   : Meds / Refills / Today / Care / Support
     · Caregiver : Meds / Refills / Overview / Connect / Support
   Vanilla JS, localStorage, zero dependencies.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- storage ---------------- */
  var KEYS = { user: "dg3.user", meds: "dg3.meds", log: "dg3.log", contact: "dg3.contact", feed: "dg3.feed", profile: "dg3.profile", seeded: "dg3.seeded", caregivers: "dg3.caregivers", patients: "dg3.patients", active: "dg3.active", settings: "dg3.settings" };
  function load(k, fb) { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch (e) { return fb; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  var state = {
    user: load(KEYS.user, null),          // { name, role: 'patient'|'caregiver', patient, phone }
    meds: load(KEYS.meds, []),
    log: load(KEYS.log, {}),              // { 'YYYY-MM-DD': { 'medId@HH:MM': 'taken'|'skipped' } }
    contact: load(KEYS.contact, null),    // the other person (active patient, caregiver role)
    feed: load(KEYS.feed, []),            // [{t, txt}]
    profile: load(KEYS.profile, null),    // the patient's health record
    caregivers: load(KEYS.caregivers, null), // patient role: [{name, relation, phone}] primary + secondary
    patients: load(KEYS.patients, null),     // caregiver role: [{id, name, phone, relation, meds, log, feed, profile}]
    activePatient: load(KEYS.active, null),  // caregiver role: id of the patient being viewed
    settings: load(KEYS.settings, { remindersOn: false, sosIndex: 0 }),
    profileUnlocked: false,               // session-only 2FA gate for the health profile
    selectedDate: new Date(),
    view: "home",
    editing: null,
    calOpen: false,
    calCursor: new Date()
  };
  function persist() {
    save(KEYS.meds, state.meds); save(KEYS.log, state.log);
    save(KEYS.contact, state.contact); save(KEYS.feed, state.feed);
    save(KEYS.profile, state.profile);
    save(KEYS.caregivers, state.caregivers);
    save(KEYS.settings, state.settings);
    if (isCg() && state.patients) { saveActivePatient(); save(KEYS.patients, state.patients); save(KEYS.active, state.activePatient); }
  }

  /* ---------------- caregiver multi-patient helpers ---------------- */
  function saveActivePatient() {
    if (!state.patients || !state.activePatient) return;
    for (var i = 0; i < state.patients.length; i++) {
      if (state.patients[i].id === state.activePatient) {
        var p = state.patients[i];
        p.meds = state.meds; p.log = state.log; p.feed = state.feed; p.profile = state.profile;
        if (state.contact) { p.name = state.contact.name; if (state.contact.phone) p.phone = state.contact.phone; if (state.contact.relation && state.contact.relation !== "Patient") p.relation = state.contact.relation; }
        break;
      }
    }
  }
  function loadPatient(id) {
    if (!state.patients) return;
    for (var i = 0; i < state.patients.length; i++) {
      if (state.patients[i].id === id) {
        var p = state.patients[i];
        state.activePatient = id;
        state.meds = p.meds || []; state.log = p.log || {}; state.feed = p.feed || []; state.profile = p.profile || null;
        state.contact = { name: p.name, relation: p.relation || "Patient", phone: p.phone || "" };
        break;
      }
    }
  }
  function switchPatient(id) {
    if (id === state.activePatient) return;
    saveActivePatient();
    loadPatient(id);
    state.profileUnlocked = false;
    state.selectedDate = new Date(); state.calOpen = false;
    save(KEYS.patients, state.patients); save(KEYS.active, state.activePatient);
    save(KEYS.meds, state.meds); save(KEYS.log, state.log);
    save(KEYS.feed, state.feed); save(KEYS.profile, state.profile); save(KEYS.contact, state.contact);
  }
  function activePatientRec() {
    if (!state.patients) return null;
    for (var i = 0; i < state.patients.length; i++) if (state.patients[i].id === state.activePatient) return state.patients[i];
    return null;
  }

  /* registered accounts we can resolve by phone number (demo directory) */
  var KNOWN_CONTACTS = { "0000000000": "Rashmi" };
  function onlyDigits(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function knownName(phone) { return KNOWN_CONTACTS[onlyDigits(phone)] || null; }

  /* ---------------- helpers ---------------- */
  function uid() { return "m" + Math.random().toString(36).slice(2, 9); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function isSameDay(a, b) { return dateKey(a) === dateKey(b); }
  function timeToMin(t) { var p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function fmtTime(t) {
    var p = t.split(":"); var h = +p[0]; var ap = h >= 12 ? "PM" : "AM"; var h12 = h % 12 || 12;
    return h12 + ":" + p[1] + " " + ap;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function medById(id) { return state.meds.filter(function (m) { return m.id === id; })[0]; }
  function isCg() { return state.user && state.user.role === "caregiver"; }
  function whoName() { return isCg() ? (state.contact ? state.contact.name.split(" ")[0] : "your patient") : "you"; }
  function timeAgo(t) {
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 90) return "now";
    var m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  var GRACE = 60; // minutes past schedule before a dose counts as missed

  /* ---------------- first-run sample data (with history for rings) ---------------- */
  if (!localStorage.getItem(KEYS.seeded)) {
    state.meds = [
      { id: uid(), name: "Lisinopril", dosage: "10 mg · 1 tablet", instructions: "With water, before breakfast", times: ["09:00"], pillsLeft: 7,  pillsPerDose: 1 },
      { id: uid(), name: "Metformin",  dosage: "500 mg · 1 tablet", instructions: "After meals",                 times: ["09:00", "21:00"], pillsLeft: 26, pillsPerDose: 1 },
      { id: uid(), name: "Atorvastatin", dosage: "20 mg · 1 tablet", instructions: "Evening only",               times: ["21:00"], pillsLeft: 44, pillsPerDose: 1 }
    ];
    // Past week of adherence so the calendar rings feel alive.
    // Pattern per day-offset: 1:perfect 2:one skipped 3:perfect 4:one missed 5:perfect 6:partial
    var patterns = { 1: "all", 2: "skipLast", 3: "all", 4: "missFirst", 5: "all", 6: "skipLast" };
    Object.keys(patterns).forEach(function (off) {
      var d = new Date(); d.setDate(d.getDate() - (+off));
      var key = dateKey(d), day = {};
      var all = [];
      state.meds.forEach(function (m) { m.times.forEach(function (t) { all.push({ m: m, t: t }); }); });
      all.sort(function (a, b) { return timeToMin(a.t) - timeToMin(b.t); });
      all.forEach(function (x, i) {
        var p = patterns[off];
        if (p === "all") day[x.m.id + "@" + x.t] = "taken";
        else if (p === "skipLast") day[x.m.id + "@" + x.t] = (i === all.length - 1) ? "skipped" : "taken";
        else if (p === "missFirst") { if (i !== 0) day[x.m.id + "@" + x.t] = "taken"; }
      });
      state.log[key] = day;
    });
    state.contact = { name: "Emily Parker", relation: "Mother", phone: "555-0117" };
    state.feed = [
      { t: Date.now() - 26 * 3600e3, txt: "Emily took Metformin, evening dose" },
      { t: Date.now() - 20 * 3600e3, txt: "Refill reminder sent for Lisinopril" }
    ];
    persist();
    localStorage.setItem(KEYS.seeded, "1");
  }

  /* Default health record (idempotent, also fills older installs) */
  if (!state.profile) {
    state.profile = {
      dob: "1956-03-14",
      blood: "O+",
      conditions: ["Hypertension", "Type 2 diabetes", "High cholesterol"],
      allergies: ["Penicillin", "Sulfa drugs"],
      notes: "Mild arthritis in both hands, prefers easy-open caps.",
      physician: { name: "Dr. Sarah Chen", practice: "Beacon Hill Primary Care", phone: "555-0198" },
      pharmacy: { name: "CVS Pharmacy, Main St", phone: "555-0175" },
      insurance: { provider: "Blue Cross Blue Shield MA", plan: "Medicare Advantage PPO", memberId: "XQH482915530", group: "MA-77821", phone: "1-800-262-2583" },
      contacts: [
        { name: "Jacob Daga", relation: "Son", phone: "555-0142" },
        { name: "Priya Nair", relation: "Neighbor", phone: "555-0163" }
      ]
    };
    save(KEYS.profile, state.profile);
  }

  /* Patient role: primary + secondary caregivers (idempotent for older installs) */
  if (!state.caregivers) {
    state.caregivers = [
      { name: "Jacob Daga", relation: "Son", phone: "555-0142", kind: "Primary" },
      { name: "Priya Nair", relation: "Neighbor", phone: "555-0163", kind: "Secondary" }
    ];
    save(KEYS.caregivers, state.caregivers);
  }

  /* Build a second sample patient so caregivers can switch between people */
  function buildSecondPatient() {
    return {
      id: uid(), name: "Robert Hayes", phone: "555-0182", relation: "Father",
      meds: [
        { id: uid(), name: "Warfarin",   dosage: "5 mg · 1 tablet",  instructions: "Same time each evening", times: ["20:00"], pillsLeft: 6,  pillsPerDose: 1 },
        { id: uid(), name: "Furosemide", dosage: "20 mg · 1 tablet", instructions: "Morning, with water",    times: ["08:00"], pillsLeft: 40, pillsPerDose: 1 }
      ],
      log: {}, feed: [{ t: Date.now() - 4 * 3600e3, txt: "Robert took Furosemide" }],
      profile: {
        dob: "1948-07-02", blood: "A+",
        conditions: ["Atrial fibrillation", "Heart failure"],
        allergies: ["Aspirin"],
        notes: "Uses a walker. Hard of hearing, call the landline.",
        physician: { name: "Dr. Marcus Lee", practice: "Riverside Cardiology", phone: "555-0144" },
        pharmacy: { name: "Walgreens, Elm Ave", phone: "555-0166" },
        insurance: { provider: "Aetna", plan: "Medicare Advantage HMO", memberId: "AET7729140", group: "MA-40122", phone: "1-800-282-1366" },
        contacts: [{ name: "Emily Parker", relation: "Daughter", phone: "555-0117" }]
      }
    };
  }

  /* ---------------- dose engine ---------------- */
  function dosesForDate(d) {
    var key = dateKey(d), dayLog = state.log[key] || {}, out = [];
    state.meds.forEach(function (med) {
      med.times.forEach(function (t) {
        var dk = med.id + "@" + t, logged = dayLog[dk], status;
        if (logged) status = logged;
        else if (key < todayKey()) status = "missed";
        else if (key > todayKey()) status = "upcoming";
        else status = nowMin() > timeToMin(t) + GRACE ? "missed" : (nowMin() >= timeToMin(t) - 30 ? "due" : "upcoming");
        out.push({ med: med, time: t, doseKey: dk, status: status });
      });
    });
    out.sort(function (a, b) { return timeToMin(a.time) - timeToMin(b.time); });
    return out;
  }
  function counts(d) {
    var list = dosesForDate(d);
    var taken = 0, missed = 0, left = 0;
    list.forEach(function (x) {
      if (x.status === "taken") taken++;
      else if (x.status === "missed" || x.status === "skipped") missed++;
      else left++;
    });
    return { taken: taken, missed: missed, left: left, total: list.length };
  }
  function adherencePct(d) {
    var c = counts(d);
    return c.total ? c.taken / c.total : 0;
  }
  function nextDose() {
    if (!isSameDay(state.selectedDate, new Date())) return null;
    var list = dosesForDate(new Date());
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === "due" || list[i].status === "upcoming") return list[i];
    }
    return null;
  }
  /* every dose scheduled at the same next time slot (so two meds at 9am both show) */
  function nextDoses() {
    var first = nextDose();
    if (!first) return [];
    return dosesForDate(new Date()).filter(function (x) {
      return x.time === first.time && (x.status === "due" || x.status === "upcoming");
    });
  }
  function countdownText(t) {
    var diff = timeToMin(t) - nowMin();
    if (diff <= 0) return "due now";
    var h = Math.floor(diff / 60), m = diff % 60;
    if (h === 0) return "in " + m + " min";
    return "in " + h + " h" + (m ? " " + m + " min" : "");
  }
  function daysOfSupply(med) {
    var perDay = med.times.length * (med.pillsPerDose || 1);
    return perDay ? Math.floor(med.pillsLeft / perDay) : 999;
  }
  var LOW_DAYS = 7; // flag a refill at 7 days of supply
  function lowStock() { return state.meds.filter(function (m) { return daysOfSupply(m) <= LOW_DAYS; }); }

  /* ---------------- actions ---------------- */
  function pushFeed(txt) {
    state.feed.unshift({ t: Date.now(), txt: txt });
    state.feed = state.feed.slice(0, 20);
    persist();
  }
  function markDose(dk, status, medId) {
    var key = dateKey(state.selectedDate);
    if (!state.log[key]) state.log[key] = {};
    var prev = state.log[key][dk];
    state.log[key][dk] = status;
    var med = medById(medId);
    if (med) {
      if (status === "taken" && prev !== "taken") med.pillsLeft = Math.max(0, med.pillsLeft - (med.pillsPerDose || 1));
      if (prev === "taken" && status !== "taken") med.pillsLeft += (med.pillsPerDose || 1);
      if (status === "taken") pushFeed((isCg() ? whoName() : "You") + " took " + med.name);
    }
    persist(); render();
    if (status === "taken") toast(isCg() ? "Confirmed. " + whoName() + " took " + (med ? med.name : "the dose") : "Dose recorded. Nicely done.");
    else toast("Dose skipped");
  }
  function undoDose(dk, medId) {
    var key = dateKey(state.selectedDate);
    if (state.log[key] && state.log[key][dk]) {
      if (state.log[key][dk] === "taken") { var med = medById(medId); if (med) med.pillsLeft += (med.pillsPerDose || 1); }
      delete state.log[key][dk];
      persist(); render();
    }
  }

  /* ---------------- icons ---------------- */
  var ICONS = {
    pill:  '<path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    undo:  '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.5-7.5L3 8"/>',
    box:   '<path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>',
    alert: '<path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    bell:  '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"/>',
    heart: '<path d="M19.5 13.6 12 21l-7.5-7.4a5 5 0 1 1 7.5-6.6 5 5 0 1 1 7.5 6.6Z"/>',
    siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M4.5 21h15"/><path d="M12 2v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
    moon:  '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    grid:  '<rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/>',
    chat:  '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.5 8.5 0 1 1 21 11.5Z"/>',
    cal:   '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/>',
    left:  '<path d="m14.5 6-6 6 6 6"/>',
    right: '<path d="m9.5 6 6 6-6 6"/>',
    send:  '<path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
    home:  '<path d="m3 9.5 9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9.5 22v-8h5v8"/>',
    user:  '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22.5 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    plus:  '<path d="M12 5v14M5 12h14"/>',
    shield:'<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 11.5 2 2 4-4.5"/>',
    clip:  '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 11h6M9 15h6M9 19h3"/>'
  };
  function ic(name) { return '<svg viewBox="0 0 24 24" class="ic">' + (ICONS[name] || "") + "</svg>"; }

  /* per-med tint */
  var TINTS = [
    { bg: "#e3f0ea", fg: "#0e7a5a" },
    { bg: "#e6eef8", fg: "#3767a3" },
    { bg: "#f6edd9", fg: "#9a6d1c" },
    { bg: "#efe9f7", fg: "#6d4fa3" },
    { bg: "#f8e8ee", fg: "#a8496e" },
    { bg: "#e2f1f1", fg: "#177a7a" }
  ];
  function tintFor(med) { var i = state.meds.indexOf(med); return TINTS[(i < 0 ? 0 : i) % TINTS.length]; }
  function pillDot(med) {
    var t = tintFor(med);
    return '<div class="pill-dot" style="background:' + t.bg + ";color:" + t.fg + '">' + ic("pill") + "</div>";
  }

  /* ============================================================
     RING COMPONENTS
     ============================================================ */
  var screen = document.getElementById("screen");
  var lastRingPct = 0;
  var RING_C = 2 * Math.PI * 52;

  function ringSvg(pct) {
    var target = RING_C * (1 - pct / 100);
    var start = RING_C * (1 - lastRingPct / 100);
    return '<div class="ringbox">' +
      '<svg class="ring-svg" viewBox="0 0 120 120">' +
        '<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#3ee6a8"/><stop offset="1" stop-color="#2cc5c0"/>' +
        "</linearGradient></defs>" +
        '<circle class="ring-track" cx="60" cy="60" r="52"/>' +
        '<circle class="ring-fill" id="ringFill" cx="60" cy="60" r="52" stroke-dasharray="' + RING_C +
          '" stroke-dashoffset="' + start + '" data-target="' + target + '"/>' +
      "</svg>" +
      '<div class="ring-center"><div><b>' + pct + "%</b><span>today</span></div></div></div>";
  }
  function animateRing(pct) {
    var el = document.getElementById("ringFill");
    if (!el) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.strokeDashoffset = el.getAttribute("data-target"); });
    });
    lastRingPct = pct;
  }

  /* Apple-Watch-style mini ring around a calendar day */
  var MINI_R = 15.5, MINI_C = 2 * Math.PI * MINI_R;
  function dayRing(d) {
    var key = dateKey(d);
    var future = key > todayKey();
    var pct = future ? 0 : adherencePct(d);
    var col = pct >= 0.999 ? "#0e7a5a" : (pct > 0 ? "#d99f26" : null);
    var fill = (col && !future)
      ? '<circle class="dr-fill" cx="18" cy="18" r="' + MINI_R + '" stroke="' + col +
        '" stroke-dasharray="' + MINI_C + '" stroke-dashoffset="' + (MINI_C * (1 - pct)) + '"/>'
      : "";
    return '<span class="dayring' + (future ? " future" : "") + '">' +
      '<svg viewBox="0 0 36 36"><circle class="dr-track" cx="18" cy="18" r="' + MINI_R + '"/>' + fill + "</svg>" +
      "<b>" + d.getDate() + "</b></span>";
  }

  function weekStrip() {
    var today = new Date(), h = '<div class="weekstrip">';
    for (var i = -3; i <= 3; i++) {
      var d = new Date(today); d.setDate(today.getDate() + i);
      var cls = "day" + (isSameDay(d, today) ? " today" : "") + (isSameDay(d, state.selectedDate) ? " selected" : "");
      h += '<div class="' + cls + '" data-act="date" data-date="' + dateKey(d) + '">' +
        '<span class="dow">' + d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2) + "</span>" +
        dayRing(d) + "</div>";
    }
    return h + "</div>";
  }

  /* Expandable month calendar with adherence rings */
  function monthPanel() {
    var cur = state.calCursor, y = cur.getFullYear(), mo = cur.getMonth();
    var firstDow = new Date(y, mo, 1).getDay();
    var dim = new Date(y, mo + 1, 0).getDate();
    var title = cur.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    var h = '<div class="calpanel">' +
      '<div class="calhead">' +
        '<button class="cal-nav" data-act="calnav" data-dir="-1" aria-label="Previous month">' + ic("left") + "</button>" +
        "<b>" + title + "</b>" +
        '<button class="cal-nav" data-act="calnav" data-dir="1" aria-label="Next month">' + ic("right") + "</button>" +
      "</div>" +
      '<div class="cal-dows"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>' +
      '<div class="cal-grid">';
    for (var b = 0; b < firstDow; b++) h += "<span></span>";
    for (var day = 1; day <= dim; day++) {
      var d = new Date(y, mo, day);
      var cls = "cal-cell" + (isSameDay(d, new Date()) ? " today" : "") + (isSameDay(d, state.selectedDate) ? " selected" : "");
      h += '<button class="' + cls + '" data-act="date" data-date="' + dateKey(d) + '">' + dayRing(d) + "</button>";
    }
    h += "</div>" +
      '<div class="cal-legend">' +
        '<span><i style="background:#0e7a5a"></i>All taken</span>' +
        '<span><i style="background:#d99f26"></i>Partial</span>' +
        '<span><i class="hollow"></i>None / upcoming</span>' +
      "</div></div>";
    return h;
  }

  /* ============================================================
     SHARED CHROME
     ============================================================ */
  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  function bellOn() { return ("Notification" in window) && Notification.permission === "granted" && !!(state.settings && state.settings.remindersOn); }

  function masthead(eyebrowText, titleHtml, withCal) {
    return '<header class="masthead">' +
      '<div class="eyebrow"><span>' + eyebrowText + "</span>" +
      '<span class="hdr-btns">' +
        (withCal ? '<button class="bell-btn' + (state.calOpen ? " on" : "") + '" data-act="calopen" title="Calendar">' + ic("cal") + "</button>" : "") +
        '<button class="bell-btn' + (bellOn() ? " on" : "") + '" data-act="notify" title="Reminders">' + ic("bell") + "</button>" +
      "</span></div>" +
      '<h1 class="headline">' + titleHtml + "</h1></header>";
  }

  function statBand(c, labels) {
    return '<section class="statband">' +
      '<div class="stat ok"><b>' + c.taken + "</b><span>" + labels[0] + "</span></div>" +
      '<div class="stat' + (c.missed ? " warn" : "") + '"><b>' + c.missed + "</b><span>" + labels[1] + "</span></div>" +
      '<div class="stat"><b>' + c.left + "</b><span>" + labels[2] + "</span></div></section>";
  }

  function tlRow(x) {
    var m = x.med, s = x.status, cg = isCg();
    var badge =
      s === "taken"   ? '<span class="badge taken">Taken</span>' :
      s === "skipped" ? '<span class="badge missed">Skipped</span>' :
      s === "missed"  ? '<span class="badge missed">Missed</span>' :
      s === "due"     ? '<span class="badge due">Due</span>' :
                        '<span class="badge up">Later</span>';
    var actions = "";
    if (s === "taken" || s === "skipped") {
      actions = '<button class="btn btn-quiet btn-undo" data-act="undo" data-key="' + x.doseKey + '" data-med="' + m.id + '">' + ic("undo") + "Undo</button>";
    } else {
      actions =
        '<button class="btn btn-take" data-act="take" data-key="' + x.doseKey + '" data-med="' + m.id + '">' + ic("check") + (cg ? "Confirm" : "Take") + "</button>" +
        (cg && (s === "missed" || s === "due")
          ? '<button class="btn btn-quiet" data-act="nudge" data-med="' + m.id + '">' + ic("send") + "Nudge</button>"
          : '<button class="btn btn-quiet" data-act="skip" data-key="' + x.doseKey + '" data-med="' + m.id + '">Skip</button>');
    }
    var cls = s === "taken" ? "s-taken" : s === "due" ? "s-due" : (s === "missed" || s === "skipped") ? "s-missed" : "s-up";
    return '<div class="tl-row ' + cls + '">' +
      '<div class="tl-time">' + fmtTime(x.time) + '</div><div class="tl-dot"></div>' +
      '<div class="dose"><div class="dose-top">' + pillDot(m) +
        '<div class="dose-info"><div class="dose-name">' + esc(m.name) + "</div>" +
        '<div class="dose-meta">' + esc(m.dosage) + (m.instructions ? " · " + esc(m.instructions) : "") + "</div></div>" +
        badge + "</div>" +
      '<div class="dose-actions">' + actions + "</div></div></div>";
  }

  function emptyState(icon, title, sub) {
    return '<div class="empty"><div class="glyph">' + ic(icon) + "</div><h3>" + title + "</h3><p>" + sub + "</p></div>";
  }

  function primaryCaregiver() {
    if (isCg()) return state.contact;
    if (state.caregivers && state.caregivers.length) return state.caregivers[0];
    return state.contact;
  }
  /* the caregiver chosen to receive the emergency call (patient side) */
  function emergencyCaregiver() {
    if (isCg()) return state.contact;
    var i = (state.settings && state.settings.sosIndex) || 0;
    if (state.caregivers && state.caregivers[i]) return state.caregivers[i];
    if (state.caregivers && state.caregivers.length) return state.caregivers[0];
    return state.contact;
  }

  /* one row per medication due at the next time slot, each with its notes + action */
  function focusMedRow(x) {
    var cg = isCg();
    return '<div class="focus-med">' +
      '<div class="focus-med-info"><b>' + esc(x.med.name) + "</b>" +
        '<span>' + esc(x.med.dosage) + (x.med.instructions ? " · " + esc(x.med.instructions) : "") + "</span></div>" +
      '<button class="focus-take" data-act="take" data-key="' + x.doseKey + '" data-med="' + x.med.id + '">' +
        ic("check") + (cg ? "Confirm" : "Take") + "</button></div>";
  }
  function focusUpNext(pct, them) {
    var doses = nextDoses();
    if (!doses.length) {
      return '<section class="focus focus-done"><div class="focus-row">' + ringSvg(pct) +
        '<div class="focus-info">' +
          '<div class="focus-eyebrow">' + ic("moon") + "Schedule complete</div>" +
          '<div class="focus-name">All clear</div>' +
          '<div class="focus-meta">Every remaining dose is accounted for. Rest easy, DoseGuide is watching the clock.</div>' +
        "</div></div></section>";
    }
    var t = doses[0].time;
    var eyebrow = them ? esc(them) + ", up next" : "Up next";
    var h = '<section class="focus"><div class="focus-row">' + ringSvg(pct) +
      '<div class="focus-info">' +
        '<div class="focus-eyebrow"><span class="pulse"></span>' + eyebrow + "</div>" +
        '<div class="focus-name">' + (doses.length > 1 ? doses.length + " meds together" : esc(doses[0].med.name)) + "</div>" +
        '<div class="focus-when">' + fmtTime(t) + " <b id='countdown'>" + countdownText(t) + "</b></div>" +
      "</div></div>" +
      '<div class="focus-meds">' + doses.map(focusMedRow).join("") + "</div></section>";
    return h;
  }

  /* ============================================================
     PATIENT HOME
     ============================================================ */
  function viewPatientHome() {
    var d = state.selectedDate;
    var today = isSameDay(d, new Date());
    var c = counts(d);
    var list = dosesForDate(d);
    var low = lowStock();
    var name = state.user && state.user.name ? state.user.name.split(" ")[0] : "";
    var pct = c.total ? Math.round((c.taken / c.total) * 100) : 0;

    var dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    var h = masthead(dateLine, greeting() + (name ? ", <em>" + esc(name) + "</em>" : ""), true);

    /* calendar first, then today's medication */
    h += state.calOpen ? monthPanel() : weekStrip();

    /* "Up next" leads today's medication */
    if (today && c.total > 0) h += focusUpNext(pct, "");

    /* one-touch emergency, always on home, reflects the chosen caregiver */
    var pc = emergencyCaregiver();
    h += '<button class="sos sos-slim" data-act="sos">' + ic("siren") +
      "Emergency" + (pc && pc.name ? ", call " + esc(pc.name.split(" ")[0]) : " call") + "</button>";

    if (low.length) {
      h += '<div class="notice"><div class="n-ico">' + ic("box") + "</div><div>" +
        "<h4>Refill running low</h4><p>" +
        low.map(function (m) { return esc(m.name) + ", " + daysOfSupply(m) + " days left"; }).join(" · ") +
        "</p></div><button data-act=\"goto\" data-view=\"refills\">Review</button></div>";
    }

    if (c.total) h += statBand(c, ["Taken", "Missed", "Remaining"]);

    if (!list.length) return h + emptyState("pill", "Nothing scheduled", "Add your first medication from the Meds tab.");

    h += '<div class="tl-head">' + (today ? "Today’s schedule" : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })) + "</div>";
    h += '<div class="tl">';
    list.forEach(function (x) { h += tlRow(x); });
    return h + "</div>";
  }

  /* ============================================================
     CAREGIVER OVERVIEW
     ============================================================ */
  function viewCaregiverHome() {
    var d = state.selectedDate;
    var today = isSameDay(d, new Date());
    var c = counts(d);
    var list = dosesForDate(d);
    var low = lowStock();
    var me = state.user && state.user.name ? state.user.name.split(" ")[0] : "";
    var them = whoName();
    var pct = c.total ? Math.round((c.taken / c.total) * 100) : 0;

    var dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    var h = masthead(dateLine, "Watching over <em>" + esc(them) + "</em>", true);

    /* switch between the people you care for */
    h += patientSwitcher();

    /* "Up next" leads the screen, showing every med at the next slot with notes */
    if (today && c.total > 0) {
      h += focusUpNext(pct, them);
      h += '<div class="cg-actions">' +
        '<button class="btn btn-take" data-act="nudge">' + ic("send") + "Remind " + esc(them) + "</button>" +
        '<button class="btn btn-quiet" data-act="call">' + ic("phone") + "Call</button></div>";
    }

    h += state.calOpen ? monthPanel() : weekStrip();

    /* needs-attention feed */
    var missed = list.filter(function (x) { return x.status === "missed"; });
    if (missed.length || low.length) {
      h += '<div class="tl-head">Needs attention</div>';
      missed.forEach(function (x) {
        h += '<div class="notice danger"><div class="n-ico">' + ic("alert") + "</div><div>" +
          "<h4>Missed: " + esc(x.med.name) + " at " + fmtTime(x.time) + "</h4>" +
          "<p>No confirmation from " + esc(them) + " yet.</p></div>" +
          '<button data-act="nudge" data-med="' + x.med.id + '">Nudge</button></div>';
      });
      low.forEach(function (m) {
        h += '<div class="notice"><div class="n-ico">' + ic("box") + "</div><div>" +
          "<h4>" + esc(m.name) + " running low</h4><p>" + m.pillsLeft + " pills · about " + daysOfSupply(m) + " days left.</p></div>" +
          '<button data-act="goto" data-view="refills">Order</button></div>';
      });
    } else if (c.total) {
      h += '<div class="notice ok"><div class="n-ico">' + ic("check") + "</div><div>" +
        "<h4>All on track</h4><p>No missed doses and supplies look healthy.</p></div></div>";
    }

    if (c.total) h += statBand(c, ["Taken", "Missed", "Remaining"]);

    if (!list.length) return h + emptyState("pill", "No medications yet", "Add " + esc(them) + "’s medications from the Meds tab.");

    h += '<div class="tl-head">' + esc(them) + "’s schedule</div>";
    h += '<div class="tl">';
    list.forEach(function (x) { h += tlRow(x); });
    return h + "</div>";
  }

  function patientSwitcher() {
    if (!state.patients || state.patients.length < 2) return "";
    return '<div class="pt-switch">' + state.patients.map(function (p) {
      var on = p.id === state.activePatient;
      return '<button class="pt-chip' + (on ? " on" : "") + '" data-act="switchpatient" data-id="' + p.id + '">' +
        '<span class="pt-ini">' + esc(initialsOf(p.name)) + "</span>" + esc(p.name.split(" ")[0]) + "</button>";
    }).join("") + "</div>";
  }

  /* ============================================================
     MEDS / ADD / REFILLS (shared)
     ============================================================ */
  function viewMeds() {
    var owner = isCg() ? whoName() + "’s cabinet" : "Your cabinet";
    var h = '<div class="head-row">' + masthead(owner, "Medications") +
      '<button class="add-top" data-act="addmed">' + ic("plus") + "Add</button></div>";
    if (!state.meds.length) return h + emptyState("pill", "No medications yet", "Tap Add to enter the first one.");
    state.meds.forEach(function (m) {
      var days = daysOfSupply(m), low = days <= LOW_DAYS;
      h += '<div class="medcard"><div class="medcard-top">' + pillDot(m) +
        '<div class="medcard-info"><div class="medcard-name">' + esc(m.name) +
          (low ? ' <span class="flag">Restock</span>' : "") + "</div>" +
        '<div class="medcard-meta">' + esc(m.dosage) + " · " + m.times.map(fmtTime).join(", ") + "</div></div>" +
        '<button class="link-btn" data-act="edit" data-med="' + m.id + '">Edit</button></div>' +
        '<div class="stock' + (low ? " low" : "") + '"><div class="stock-row"><span>' + m.pillsLeft +
          ' pills on hand</span><span class="stock-days">' + days + " days</span></div>" +
        '<div class="stock-bar"><span style="width:' + Math.min(100, days * 4) + '%"></span></div>' +
        (low ? '<button class="restock-link" data-act="restock" data-med="' + m.id + '">Mark restocked</button>' : "") +
        "</div></div>";
    });
    return h;
  }

  function parseDosage(str) {
    var out = { amt: "", unit: "mg", tabs: "1" };
    if (!str) return out;
    var mm = str.match(/([\d.]+)\s*(mcg|mg|g)\b/i);
    if (mm) { out.amt = mm[1]; out.unit = mm[2].toLowerCase(); }
    var tt = str.match(/([\d.]+)\s*(tablet|tab|pill|capsule|cap)/i);
    if (tt) out.tabs = tt[1];
    return out;
  }
  function buildDosage(amt, unit, tabs) {
    var parts = [];
    if (amt) parts.push(amt + " " + unit);
    var n = parseFloat(tabs) || 1;
    parts.push(n + " " + (n === 1 ? "tablet" : "tablets"));
    return parts.join(" · ");
  }
  function timeOptions(sel) {
    var out = "";
    for (var hh = 0; hh < 24; hh++) {
      for (var mm = 0; mm < 60; mm += 30) {
        var v = pad(hh) + ":" + pad(mm);
        out += '<option value="' + v + '"' + (v === sel ? " selected" : "") + ">" + fmtTime(v) + "</option>";
      }
    }
    return out;
  }

  var tempTimes = [];
  function viewAdd(editing) {
    var m = editing || { name: "", dosage: "", instructions: "", times: ["09:00"], pillsLeft: 30 };
    tempTimes = m.times.slice();
    var dz = parseDosage(m.dosage);
    var h = masthead(editing ? "Edit" : "New medication", editing ? esc(m.name) : "Add a <em>medication</em>");
    h += '<div class="field"><label>Name</label><input id="f-name" placeholder="e.g. Lisinopril" value="' + esc(m.name) + '"></div>' +
      '<div class="field"><label>Strength</label>' +
        '<div class="dose-split"><input id="f-dose-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="10" value="' + esc(dz.amt) + '">' +
        '<select id="f-dose-unit">' +
          '<option value="mg"' + (dz.unit === "mg" ? " selected" : "") + ">mg</option>" +
          '<option value="g"' + (dz.unit === "g" ? " selected" : "") + ">g</option>" +
          '<option value="mcg"' + (dz.unit === "mcg" ? " selected" : "") + ">mcg</option>" +
        "</select></div></div>" +
      '<div class="field"><label>Tablets per dose</label>' +
        '<input id="f-dose-tabs" type="number" min="1" step="1" inputmode="numeric" value="' + esc(dz.tabs) + '"></div>' +
      '<div class="field"><label>Instructions · optional</label>' +
        '<input id="f-inst" placeholder="e.g. Before food" value="' + esc(m.instructions) + '"></div>' +
      '<div class="field"><label>Dose times</label><div class="times" id="time-list"></div>' +
        '<div class="add-time"><select id="f-time">' + timeOptions("09:00") + "</select>" +
        '<button data-act="addtime">Add</button></div>' +
        '<div class="hint">Add every time of day this is taken. Reminders follow this schedule.</div></div>' +
      '<div class="field"><label>Pills on hand</label><input id="f-pills" type="number" min="0" inputmode="numeric" value="' + m.pillsLeft + '">' +
        '<div class="hint">DoseGuide counts down with every dose and flags a refill before they run out.</div></div>' +
      '<button class="btn-primary" data-act="savemed">' + (editing ? "Save changes" : "Add medication") + "</button>";
    if (editing) h += '<button class="btn-danger-ghost" data-act="delmed">Remove this medication</button>';
    return h;
  }
  function renderChips() {
    var host = document.getElementById("time-list");
    if (!host) return;
    tempTimes.sort(function (a, b) { return timeToMin(a) - timeToMin(b); });
    host.innerHTML = tempTimes.length
      ? tempTimes.map(function (t, i) {
          return '<span class="time-chip">' + fmtTime(t) + '<button data-act="rmtime" data-i="' + i + '">×</button></span>';
        }).join("")
      : '<span class="hint">No times yet, add one below.</span>';
  }

  function viewRefills() {
    var h = masthead("Supply", "Refills");
    var low = lowStock();
    if (low.length) {
      h += '<div class="notice danger"><div class="n-ico">' + ic("alert") + "</div><div>" +
        "<h4>" + low.length + " medication" + (low.length > 1 ? "s" : "") + " running low</h4>" +
        "<p>Order refills soon to avoid an interruption.</p></div></div>";
    }
    if (!state.meds.length) return h + emptyState("box", "Nothing to track", "Add a medication first. Supply tracking starts automatically.");
    state.meds.slice().sort(function (a, b) { return daysOfSupply(a) - daysOfSupply(b); }).forEach(function (m) {
      var days = daysOfSupply(m), low2 = days <= LOW_DAYS;
      h += '<div class="medcard"><div class="medcard-top">' + pillDot(m) +
        '<div class="medcard-info"><div class="medcard-name">' + esc(m.name) +
          (low2 ? ' <span class="flag">Restock</span>' : "") + "</div>" +
        '<div class="medcard-meta">' + m.pillsLeft + " pills · about " + days + " days</div></div></div>" +
        '<div class="stock' + (low2 ? " low" : "") + '"><div class="stock-bar"><span style="width:' + Math.min(100, days * 4) + '%"></span></div></div>' +
        '<div class="dose-actions">' +
          '<button class="btn btn-take" data-act="order" data-med="' + m.id + '">' + ic("box") + "Order refill</button>" +
          '<button class="btn btn-quiet" data-act="restock" data-med="' + m.id + '">Restocked</button></div></div>';
    });
    h += '<p class="hint" style="text-align:center;margin-top:16px">Direct CVS &amp; Walgreens ordering arrives with pharmacy integration (roadmap Q1).</p>';
    return h;
  }

  /* ============================================================
     CARE (patient) / CONNECT (caregiver)
     ============================================================ */
  function caregiverRow(c, idx) {
    var sos = ((state.settings && state.settings.sosIndex) || 0) === idx;
    return '<div class="care-person cg-row' + (sos ? " sos-selected" : "") + '" data-act="setsos" data-i="' + idx + '">' +
      '<div class="avatar">' + esc(initialsOf(c.name)) + "</div>" +
      '<div style="flex:1;min-width:0"><b>' + esc(c.name) + "</b><span>" + esc(c.relation || "") +
      (c.relation && c.phone ? " · " : "") + esc(c.phone || "") + "</span></div>" +
      (sos ? '<span class="sos-tag">' + ic("siren") + "Emergency</span>" : '<span class="badge ' + (idx === 0 ? "taken" : "up") + '">' + (idx === 0 ? "Primary" : "Secondary") + "</span>") +
      '<button class="mini-btn" data-act="editcg" data-i="' + idx + '" title="Edit">' + ic("user") + "</button></div>";
  }
  function viewCare() {
    if (isCg()) return viewConnect();
    var cgs = state.caregivers || [];
    var h = masthead("Circle of care", "Care &amp; settings");

    var emc = emergencyCaregiver();
    h += '<div class="card"><h3>' + ic("heart") + "Caregivers</h3>" +
      '<p class="muted">Tap a caregiver to choose who your emergency call reaches. Both get the daily summary.</p>';
    if (cgs.length) {
      cgs.forEach(function (c, i) { h += caregiverRow(c, i); });
      h += '<div class="dose-actions">' +
        '<button class="btn btn-take" data-act="share">' + ic("share") + "Share today</button>" +
        '<button class="btn btn-quiet" data-act="call">' + ic("phone") + "Call " + (emc && emc.name ? esc(emc.name.split(" ")[0]) : "caregiver") + "</button></div>";
      if (cgs.length < 2) h += '<button class="link-btn" data-act="editcg" data-i="1" style="margin-top:10px">+ Add secondary caregiver</button>';
    } else {
      h += '<button class="btn-primary" data-act="editcg" data-i="0">Add a caregiver</button>';
    }
    h += "</div>";

    h += '<div class="card"><div class="card-head"><h3>' + ic("clip") + "My health profile" +
      '<span class="lock-chip">' + ic("shield") + "2FA</span></h3>" +
      '<button class="link-btn" data-act="gate">Open</button></div>' +
      '<p class="muted" style="margin:0">Medical history, insurance and emergency contacts, ready whenever a doctor or pharmacist asks. Protected by a verification code.</p></div>';

    h += remindersCard();
    h += '<button class="sos" data-act="sos">' + ic("siren") + "Emergency, call " + (emc && emc.name ? esc(emc.name.split(" ")[0]) : "caregiver") + "</button>";
    return h;
  }

  function viewConnect() {
    var c = state.contact;
    var them = whoName();
    var h = masthead("Stay close", "Connect");

    h += '<div class="card"><h3>' + ic("user") + esc(them) + "</h3>" +
      '<p class="muted">The person you care for, one tap away.</p>';
    if (c) {
      h += personRow(c) +
        '<div class="dose-actions">' +
          '<button class="btn btn-take" data-act="call">' + ic("phone") + "Call " + esc(them) + "</button>" +
          '<button class="btn btn-quiet" data-act="share">' + ic("share") + "Share summary</button></div>" +
        '<div class="rowlinks">' +
          '<button class="link-btn" data-act="gate">Full health profile</button>' +
          '<button class="link-btn" data-act="editcontact">Edit contact</button></div>';
    } else {
      h += '<button class="btn-primary" data-act="editcontact">Add your patient</button>';
    }
    h += "</div>";

    h += '<div class="card"><div class="card-head"><h3>' + ic("users") + "People you care for</h3></div>" +
      '<p class="muted">Switch between them on the Overview tab. Add another to link a new account.</p>';
    (state.patients || []).forEach(function (p) {
      var on = p.id === state.activePatient;
      h += '<div class="care-person"><div class="avatar">' + esc(initialsOf(p.name)) + "</div>" +
        '<div style="flex:1;min-width:0"><b>' + esc(p.name) + "</b><span>" + esc(p.relation || "Patient") +
        (p.phone ? " · " + esc(p.phone) : "") + "</span></div>" +
        (on ? '<span class="badge taken">Viewing</span>'
            : '<button class="link-btn" data-act="switchpatient" data-id="' + p.id + '">View</button>') + "</div>";
    });
    h += '<button class="btn-primary" data-act="addperson" style="margin-top:6px">+ Add another person</button></div>';

    h += '<div class="card"><h3>' + ic("chat") + "Quick messages</h3>" +
      '<p class="muted">One-tap notes that appear on ' + esc(them) + "’s phone. No reply needed.</p>" +
      '<div class="chips">' +
        '<button class="chip" data-act="msg" data-txt="Time for your medicine">Time for your medicine</button>' +
        '<button class="chip" data-act="msg" data-txt="Your refill is ordered">Your refill is ordered</button>' +
        '<button class="chip" data-act="msg" data-txt="Calling you in 5 minutes">Calling you in 5 minutes</button>' +
        '<button class="chip" data-act="msg" data-txt="Great job staying on track">Great job staying on track</button>' +
      "</div></div>";

    h += '<div class="card"><h3>' + ic("grid") + "Recent activity</h3>";
    if (state.feed.length) {
      h += '<ul class="feed">' + state.feed.slice(0, 8).map(function (f) {
        return "<li>" + ic("check") + "<span>" + esc(f.txt) + "</span><time>" + timeAgo(f.t) + "</time></li>";
      }).join("") + "</ul>";
    } else {
      h += '<p class="muted" style="margin:0">Activity will appear here as doses are taken and reminders are sent.</p>';
    }
    h += "</div>";

    h += remindersCard();
    return h;
  }

  function personRow(c) {
    var initials = c.name.split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
    return '<div class="care-person"><div class="avatar">' + esc(initials) + "</div>" +
      "<div><b>" + esc(c.name) + "</b><span>" + esc(c.relation || "") + (c.relation && c.phone ? " · " : "") + esc(c.phone || "") + "</span></div></div>";
  }
  function remindersCard() {
    var on = bellOn();
    return '<div class="card"><h3>' + ic("bell") + "Reminders</h3>" +
      '<p class="muted">A gentle notification at each dose time while DoseGuide is open.</p>' +
      (on
        ? '<div class="rem-row"><span class="rem-state"><span class="dot-on"></span>Reminders are on</span>' +
          '<button class="btn btn-quiet" data-act="remindersoff">Turn off</button></div>'
        : '<button class="btn-primary" data-act="notify">Turn on reminders</button>') +
      '<p class="hint">Push notifications that work with the app closed ship with the native build.</p></div>';
  }
  function dataCard() {
    var phone = state.user && state.user.phone ? state.user.phone : "";
    return '<div class="card" style="margin-top:14px"><h3>Account &amp; data</h3>' +
      '<p class="muted">' + (phone ? "Signed in as " + esc(phone) + ". " : "") +
      'Everything lives privately on this device. Nothing is uploaded.</p>' +
      '<div class="dose-actions">' +
        '<button class="btn btn-quiet" data-act="switchrole">' + ic("users") + "Sign out</button>" +
        '<button class="btn btn-quiet" data-act="reset">Reset demo</button></div></div>';
  }

  /* ============================================================
     SUPPORT (both roles)
     ============================================================ */
  function viewSupport() {
    var h = masthead("We’re here for you", "Support");
    h += '<button class="sos sos-911" data-act="call911">' + ic("siren") + "Medical emergency, call 911</button>";
    h += '<p class="hint" style="text-align:center;margin:-8px 2px 20px">For a life-threatening emergency, always call 911 first.</p>';
    h += '<div class="card"><h3>' + ic("chat") + "Chat with us</h3>" +
      '<p class="muted">Questions about doses, refills or your account? Start a chat and a specialist replies in minutes.</p>' +
      '<button class="btn-primary" data-act="chatsupport">Start a chat</button></div>';
    h += '<div class="card"><h3>' + ic("phone") + "Call support</h3>" +
      '<p class="muted">Talk to a care specialist, 8am to 8pm every day.</p>' +
      '<button class="btn-primary" data-act="callsupport">Call 1-800-367-3433</button></div>';
    h += '<p class="hint" style="text-align:center;margin:6px 0 18px">Average wait under 2 minutes.</p>';
    h += dataCard();
    return h;
  }

  /* ============================================================
     PATIENT HEALTH PROFILE
     ============================================================ */
  function initialsOf(name) {
    return String(name || "?").split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  }
  function fmtDob(iso) {
    var d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }
  function chipList(arr, cls) {
    if (!arr || !arr.length) return '<p class="muted" style="margin:0 0 4px">None recorded.</p>';
    return '<div class="chips chips-static">' + arr.map(function (x) {
      return '<span class="chip-static' + (cls ? " " + cls : "") + '">' + esc(x) + "</span>";
    }).join("") + "</div>";
  }
  function teamRow(name, sub, phone, kind) {
    if (!name) return '<p class="muted" style="margin:0 0 10px">Add ' + kind.toLowerCase() + " details.</p>";
    return '<div class="care-person contact-row">' +
      '<div class="role-ico round">' + ic(kind === "Pharmacy" ? "box" : "user") + "</div>" +
      '<div style="flex:1;min-width:0"><b>' + esc(name) + "</b><span>" + esc(sub || kind) + (phone ? " · " + esc(phone) : "") + "</span></div>" +
      (phone ? '<button class="mini-btn" data-act="dial" data-phone="' + esc(phone) + '" title="Call">' + ic("phone") + "</button>" : "") +
      "</div>";
  }

  function viewProfile() {
    var p = state.profile || {};
    var cg = isCg();
    var pname = cg ? (state.contact ? state.contact.name : "Patient")
                   : (state.user && state.user.name ? state.user.name : "Me");
    var first = pname.split(" ")[0];
    var age = "";
    if (p.dob) { var b = new Date(p.dob); if (!isNaN(b)) age = Math.floor((Date.now() - b) / 31557600000) + " yrs"; }

    var h = '<button class="back-link" data-act="goto" data-view="care">' + ic("left") + (cg ? "Connect" : "Care") + "</button>";
    h += masthead("Health record", cg ? "<em>" + esc(first) + "</em>’s profile" : "My <em>profile</em>");

    /* personal */
    h += '<div class="card"><div class="card-head"><h3>' + ic("user") + "Personal</h3>" +
      '<button class="link-btn" data-act="editpersonal">Edit</button></div>' +
      '<div class="care-person" style="margin-bottom:0"><div class="avatar">' + esc(initialsOf(pname)) + "</div>" +
      "<div style='flex:1;min-width:0'><b>" + esc(pname) + "</b><span>" +
      (p.dob ? fmtDob(p.dob) + (age ? " · " + age : "") : "Add date of birth") + "</span></div>" +
      (p.blood ? '<span class="badge missed">' + esc(p.blood) + "</span>" : "") + "</div></div>";

    /* medical history */
    h += '<div class="card"><div class="card-head"><h3>' + ic("clip") + "Medical history</h3>" +
      '<button class="link-btn" data-act="editmedical">Edit</button></div>' +
      '<div class="p-label">Conditions</div>' + chipList(p.conditions) +
      '<div class="p-label">Allergies</div>' + chipList(p.allergies, "allergy") +
      (p.notes ? '<div class="p-label">Notes</div><p class="p-notes">' + esc(p.notes) + "</p>" : "") +
      "</div>";

    /* care team */
    h += '<div class="card"><div class="card-head"><h3>' + ic("heart") + "Care team</h3>" +
      '<button class="link-btn" data-act="editcareteam">Edit</button></div>' +
      teamRow(p.physician && p.physician.name, p.physician && p.physician.practice, p.physician && p.physician.phone, "Physician") +
      teamRow(p.pharmacy && p.pharmacy.name, "Pharmacy", p.pharmacy && p.pharmacy.phone, "Pharmacy") +
      "</div>";

    /* insurance */
    h += '<div class="card"><div class="card-head"><h3>' + ic("shield") + "Insurance</h3>" +
      '<button class="link-btn" data-act="editinsurance">Edit</button></div>';
    var ins = p.insurance || {};
    if (ins.provider) {
      h += '<div class="kv"><span>Provider</span><b>' + esc(ins.provider) + "</b></div>" +
        (ins.plan ? '<div class="kv"><span>Plan</span><b>' + esc(ins.plan) + "</b></div>" : "") +
        (ins.memberId ? '<div class="kv"><span>Member ID</span><b>' + esc(ins.memberId) + "</b></div>" : "") +
        (ins.group ? '<div class="kv"><span>Group</span><b>' + esc(ins.group) + "</b></div>" : "") +
        (ins.phone ? '<div class="kv"><span>Support</span><b>' + esc(ins.phone) + "</b></div>" : "");
    } else {
      h += '<p class="muted" style="margin:0">Add insurance details for quick access at the pharmacy.</p>';
    }
    h += "</div>";

    /* emergency contacts */
    h += '<div class="card"><div class="card-head"><h3>' + ic("siren") + "Emergency contacts</h3>" +
      '<button class="link-btn" data-act="addcontact">+ Add</button></div>';
    var cts = p.contacts || [];
    if (cts.length) {
      cts.forEach(function (ct, i) {
        h += '<div class="care-person contact-row"><div class="avatar">' + esc(initialsOf(ct.name)) + "</div>" +
          '<div style="flex:1;min-width:0"><b>' + esc(ct.name) + "</b><span>" + esc(ct.relation || "") +
          (ct.relation && ct.phone ? " · " : "") + esc(ct.phone || "") + "</span></div>" +
          (ct.phone ? '<button class="mini-btn" data-act="dial" data-phone="' + esc(ct.phone) + '" title="Call">' + ic("phone") + "</button>" : "") +
          '<button class="mini-btn danger" data-act="rmcontact" data-i="' + i + '" title="Remove">×</button></div>';
      });
    } else {
      h += '<p class="muted" style="margin:0">No contacts yet, add at least one.</p>';
    }
    h += "</div>";
    return h;
  }

  /* ----- profile edit modals ----- */
  function mField(label, id, value, ph, type) {
    return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="' + (type || "text") +
      '" value="' + esc(value || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  }
  function modalShell(title, sub, body) {
    openModal("<h3>" + title + "</h3><p>" + sub + "</p>" + body +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take" id="m-ok">Save</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
  }
  function val(id) { return document.getElementById(id).value.trim(); }
  function csv(id) {
    return val(id).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function editPersonal() {
    var p = state.profile;
    modalShell("Personal details", "Basics that matter in an emergency.",
      mField("Date of birth", "m-dob", p.dob, "", "date") +
      mField("Blood type", "m-blood", p.blood, "e.g. O+"));
    document.getElementById("m-ok").onclick = function () {
      p.dob = val("m-dob"); p.blood = val("m-blood");
      persist(); closeModal(); render(); toast("Saved");
    };
  }
  function editMedical() {
    var p = state.profile;
    modalShell("Medical history", "Separate multiple entries with commas.",
      mField("Conditions", "m-cond", (p.conditions || []).join(", "), "e.g. Hypertension, Diabetes") +
      mField("Allergies", "m-alg", (p.allergies || []).join(", "), "e.g. Penicillin") +
      mField("Notes", "m-notes", p.notes, "Anything a doctor should know"));
    document.getElementById("m-ok").onclick = function () {
      p.conditions = csv("m-cond"); p.allergies = csv("m-alg"); p.notes = val("m-notes");
      persist(); closeModal(); render(); toast("Saved");
    };
  }
  function editCareTeam() {
    var p = state.profile;
    p.physician = p.physician || {}; p.pharmacy = p.pharmacy || {};
    modalShell("Care team", "The doctor and pharmacy on speed dial.",
      mField("Physician", "m-dr", p.physician.name, "e.g. Dr. Sarah Chen") +
      mField("Practice", "m-pr", p.physician.practice, "e.g. Beacon Hill Primary Care") +
      mField("Physician phone", "m-drp", p.physician.phone, "", "tel") +
      mField("Pharmacy", "m-ph", p.pharmacy.name, "e.g. CVS, Main St") +
      mField("Pharmacy phone", "m-php", p.pharmacy.phone, "", "tel"));
    document.getElementById("m-ok").onclick = function () {
      p.physician = { name: val("m-dr"), practice: val("m-pr"), phone: val("m-drp") };
      p.pharmacy = { name: val("m-ph"), phone: val("m-php") };
      persist(); closeModal(); render(); toast("Saved");
    };
  }
  function editInsurance() {
    var p = state.profile;
    var ins = p.insurance || {};
    modalShell("Insurance", "Shown exactly as it appears on the card.",
      mField("Provider", "m-prov", ins.provider, "e.g. Blue Cross Blue Shield MA") +
      mField("Plan", "m-plan", ins.plan, "e.g. Medicare Advantage PPO") +
      mField("Member ID", "m-mid", ins.memberId, "") +
      mField("Group number", "m-grp", ins.group, "") +
      mField("Support phone", "m-insp", ins.phone, "", "tel"));
    document.getElementById("m-ok").onclick = function () {
      p.insurance = { provider: val("m-prov"), plan: val("m-plan"), memberId: val("m-mid"), group: val("m-grp"), phone: val("m-insp") };
      persist(); closeModal(); render(); toast("Saved");
    };
  }
  function addEmergencyContact() {
    modalShell("Emergency contact", "Someone to reach when it matters.",
      mField("Name", "m-cn", "", "e.g. Priya Nair") +
      mField("Relationship", "m-cr", "", "e.g. Neighbor") +
      mField("Phone", "m-cp", "", "", "tel"));
    document.getElementById("m-ok").onclick = function () {
      var name = val("m-cn");
      if (!name) { toast("Add their name"); return; }
      state.profile.contacts = state.profile.contacts || [];
      state.profile.contacts.push({ name: name, relation: val("m-cr"), phone: val("m-cp") });
      persist(); closeModal(); render(); toast(name.split(" ")[0] + " added");
    };
  }

  /* ============================================================
     RENDER + TAB BAR
     ============================================================ */
  var tabbar = document.getElementById("tabbar");

  function renderTabbar() {
    var cg = isCg();
    function tabBtn(view, label, icon) {
      return '<button class="tab" data-view="' + view + '">' + ic(icon) + "<span>" + label + "</span></button>";
    }
    tabbar.innerHTML =
      tabBtn("meds", "Meds", "pill") +
      '<button class="tab" data-view="refills">' + ic("box") +
        '<span class="tab-dot" id="refillDot" hidden></span><span>Refills</span></button>' +
      '<button class="tab tab-home" data-view="home" aria-label="Overview">' +
        '<span class="home-glow">' + ic(cg ? "grid" : "home") + "</span>" +
        '<span class="home-lbl">Overview</span></button>' +
      tabBtn("care", cg ? "Connect" : "Care", cg ? "chat" : "heart") +
      tabBtn("support", "Support", "phone");
    tabbar.style.display = "";
    syncTabs();
    updateTabFlags();
  }
  function updateTabFlags() {
    var d = document.getElementById("refillDot");
    if (d) d.hidden = !lowStock().length;
  }

  function render() {
    var v = state.view, html = "";
    if (v === "home") html = isCg() ? viewCaregiverHome() : viewPatientHome();
    else if (v === "meds") html = viewMeds();
    else if (v === "add") html = viewAdd(null);
    else if (v === "edit") html = viewAdd(state.editing);
    else if (v === "refills") html = viewRefills();
    else if (v === "care") html = viewCare();
    else if (v === "support") html = viewSupport();
    else if (v === "profile") html = viewProfile();
    screen.innerHTML = '<div class="view">' + html + "</div>";
    if (v === "add" || v === "edit") renderChips();
    if (v === "home") {
      var c = counts(state.selectedDate);
      animateRing(c.total ? Math.round((c.taken / c.total) * 100) : 0);
    }
    syncTabs();
    updateTabFlags();
    screen.scrollTop = 0;
  }
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (el) {
      var v = el.getAttribute("data-view");
      el.classList.toggle("is-active", v === state.view ||
        ((state.view === "edit" || state.view === "add") && v === "meds") ||
        (state.view === "profile" && v === "care"));
    });
  }

  tabbar.addEventListener("click", function (e) {
    var t = e.target.closest(".tab"); if (!t) return;
    state.view = t.getAttribute("data-view");
    state.editing = null;
    render();
  });

  screen.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var act = el.getAttribute("data-act");
    var key = el.getAttribute("data-key"), medId = el.getAttribute("data-med");

    if (act === "date") {
      var p = el.getAttribute("data-date").split("-");
      state.selectedDate = new Date(+p[0], +p[1] - 1, +p[2]); render();
    }
    else if (act === "calopen") {
      state.calOpen = !state.calOpen;
      state.calCursor = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
      render();
    }
    else if (act === "calnav") {
      var dir = +el.getAttribute("data-dir");
      state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() + dir, 1);
      render();
    }
    else if (act === "take") markDose(key, "taken", medId);
    else if (act === "skip") markDose(key, "skipped", medId);
    else if (act === "undo") undoDose(key, medId);
    else if (act === "goto") { state.view = el.getAttribute("data-view"); render(); }
    else if (act === "gate") openProfileGate();
    else if (act === "edit") { state.editing = medById(medId); state.view = "edit"; render(); }
    else if (act === "addmed") { state.editing = null; state.view = "add"; render(); }
    else if (act === "switchpatient") {
      switchPatient(el.getAttribute("data-id"));
      state.view = "home"; render();
      toast("Now viewing " + (state.contact ? state.contact.name.split(" ")[0] : "patient"));
    }
    else if (act === "addperson") addPatientModal();
    else if (act === "addtime") {
      var v = document.getElementById("f-time").value;
      if (v && tempTimes.indexOf(v) === -1) { tempTimes.push(v); renderChips(); toast(fmtTime(v) + " added"); }
      else toast("That time is already added");
    }
    else if (act === "rmtime") { tempTimes.splice(+el.getAttribute("data-i"), 1); renderChips(); }
    else if (act === "savemed") saveMed();
    else if (act === "delmed") confirmDelete();
    else if (act === "order") {
      var m1 = medById(medId);
      window.open("https://www.google.com/maps/search/pharmacy+near+me", "_blank");
      if (m1) pushFeed("Refill search opened for " + m1.name);
      toast("Finding pharmacies near you" + (m1 ? " for " + m1.name : ""));
    }
    else if (act === "restock") restockModal(medId);
    else if (act === "editcontact") contactModal();
    else if (act === "editpersonal") editPersonal();
    else if (act === "editmedical") editMedical();
    else if (act === "editcareteam") editCareTeam();
    else if (act === "editinsurance") editInsurance();
    else if (act === "addcontact") addEmergencyContact();
    else if (act === "rmcontact") {
      var removed = state.profile.contacts.splice(+el.getAttribute("data-i"), 1)[0];
      persist(); render(); toast((removed ? removed.name.split(" ")[0] : "Contact") + " removed");
    }
    else if (act === "dial") { window.location.href = "tel:" + el.getAttribute("data-phone"); }
    else if (act === "share") shareToday();
    else if (act === "call" || act === "sos") callContact(act === "sos");
    else if (act === "call911") { toast("Connecting to 911"); window.location.href = "tel:911"; }
    else if (act === "callsupport") { toast("Calling DoseGuide support"); window.location.href = "tel:18003673433"; }
    else if (act === "chatsupport") { toast("A specialist will be with you shortly"); }
    else if (act === "editcg") caregiverModal(+el.getAttribute("data-i"));
    else if (act === "setsos") {
      state.settings.sosIndex = +el.getAttribute("data-i");
      save(KEYS.settings, state.settings);
      render();
      var ec = emergencyCaregiver();
      toast((ec && ec.name ? ec.name.split(" ")[0] : "Caregiver") + " is now your emergency contact");
    }
    else if (act === "notify") requestNotify();
    else if (act === "remindersoff") {
      state.settings.remindersOn = false; save(KEYS.settings, state.settings);
      scheduleReminders(); render(); toast("Reminders turned off");
    }
    else if (act === "reset") confirmReset();
    else if (act === "switchrole") switchRole();
    else if (act === "nudge") {
      var mN = medId ? medById(medId) : null;
      var who = whoName();
      pushFeed("You nudged " + who + (mN ? " about " + mN.name : ""));
      toast("Reminder sent to " + who + (mN ? ", " + mN.name : ""));
      if (state.view === "home" || state.view === "care") render();
    }
    else if (act === "msg") {
      var txt = el.getAttribute("data-txt");
      pushFeed("You messaged " + whoName() + ": “" + txt + "”");
      toast("Sent to " + whoName());
      render();
    }
  });

  function saveMed() {
    var name = document.getElementById("f-name").value.trim();
    if (!name) { toast("Give the medication a name"); return; }
    if (!tempTimes.length) { toast("Add at least one dose time"); return; }
    var pills = parseInt(document.getElementById("f-pills").value, 10);
    var amt = document.getElementById("f-dose-amt").value.trim();
    var unit = document.getElementById("f-dose-unit").value;
    var tabs = parseInt(document.getElementById("f-dose-tabs").value, 10);
    if (isNaN(tabs) || tabs < 1) tabs = 1;
    var data = {
      name: name,
      dosage: buildDosage(amt, unit, tabs),
      instructions: document.getElementById("f-inst").value.trim(),
      times: tempTimes.slice(),
      pillsLeft: isNaN(pills) ? 0 : pills,
      pillsPerDose: tabs
    };
    if (state.view === "edit" && state.editing) { Object.assign(state.editing, data); state.editing = null; }
    else { data.id = uid(); state.meds.push(data); }
    persist(); scheduleReminders();
    state.view = "meds"; render(); toast("Saved");
  }

  /* ============================================================
     MODALS
     ============================================================ */
  var modalWrap = document.getElementById("modalWrap"), modalEl = document.getElementById("modal");
  function openModal(html) { modalEl.innerHTML = html; modalWrap.hidden = false; }
  function closeModal() { modalWrap.hidden = true; modalEl.innerHTML = ""; }
  document.getElementById("modalScrim").addEventListener("click", closeModal);

  function confirmDelete() {
    var m = state.editing; if (!m) return;
    openModal("<h3>Remove " + esc(m.name) + "?</h3>" +
      "<p>Its schedule and reminders will be deleted. History stays intact.</p>" +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Keep it</button>' +
      '<button class="btn btn-take m-danger" id="m-ok">Remove</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = function () {
      state.meds = state.meds.filter(function (x) { return x.id !== m.id; });
      state.editing = null; persist(); closeModal();
      state.view = "meds"; render(); toast("Medication removed");
    };
  }

  function restockModal(medId) {
    var m = medById(medId); if (!m) return;
    openModal("<h3>Restock " + esc(m.name) + "</h3>" +
      "<p>How many pills did the refill add?</p>" +
      '<div class="field"><input id="m-qty" type="number" inputmode="numeric" min="1" value="30"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take" id="m-ok">Add to supply</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = function () {
      var n = parseInt(document.getElementById("m-qty").value, 10);
      if (n > 0) {
        m.pillsLeft += n; pushFeed(m.name + " restocked (+" + n + " pills)");
        persist(); closeModal(); render(); toast(m.name + " restocked, " + m.pillsLeft + " pills");
      }
    };
  }

  function contactModal() {
    var cg = isCg();
    var c = state.contact || { name: "", relation: "", phone: "" };
    openModal("<h3>" + (cg ? "Your patient" : "Caregiver") + "</h3>" +
      "<p>" + (cg ? "The person you’re caring for." : "They’ll be one tap away for summaries and emergencies.") + "</p>" +
      '<div class="field"><label>Name</label><input id="m-name" value="' + esc(c.name) + '" placeholder="e.g. Emily Parker"></div>' +
      '<div class="field"><label>Relationship</label><input id="m-rel" value="' + esc(c.relation) + '" placeholder="' + (cg ? "e.g. Mother" : "e.g. Son") + '"></div>' +
      '<div class="field"><label>Phone</label><input id="m-phone" type="tel" value="' + esc(c.phone) + '" placeholder="e.g. 555-0117"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take" id="m-ok">Save</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = function () {
      var name = document.getElementById("m-name").value.trim();
      if (!name) { toast("Add their name"); return; }
      state.contact = { name: name, relation: document.getElementById("m-rel").value.trim(), phone: document.getElementById("m-phone").value.trim() };
      persist(); closeModal(); render(); toast("Saved");
    };
  }

  /* patient role: add / edit a primary or secondary caregiver */
  function caregiverModal(idx) {
    state.caregivers = state.caregivers || [];
    var c = state.caregivers[idx] || { name: "", relation: "", phone: "" };
    var kind = idx === 0 ? "primary" : "secondary";
    openModal("<h3>" + (state.caregivers[idx] ? "Edit " : "Add ") + kind + " caregiver</h3>" +
      "<p>They’ll be one tap away for summaries and emergencies.</p>" +
      '<div class="field"><label>Phone</label><input id="m-phone" type="tel" value="' + esc(c.phone) + '" placeholder="e.g. 555-0142"></div>' +
      '<div class="field"><label>Name</label><input id="m-name" value="' + esc(c.name) + '" placeholder="Auto-filled if registered"></div>' +
      '<div class="field"><label>Relationship</label><input id="m-rel" value="' + esc(c.relation) + '" placeholder="e.g. Son"></div>' +
      '<div class="modal-actions">' +
      (state.caregivers[idx] && idx > 0 ? '<button class="btn btn-quiet m-danger" id="m-del">Remove</button>' : '<button class="btn btn-quiet" id="m-cancel">Cancel</button>') +
      '<button class="btn btn-take" id="m-ok">Save</button></div>');
    var cancel = document.getElementById("m-cancel");
    if (cancel) cancel.onclick = closeModal;
    var del = document.getElementById("m-del");
    if (del) del.onclick = function () { state.caregivers.splice(idx, 1); syncPrimaryContact(); persist(); closeModal(); render(); toast("Caregiver removed"); };
    document.getElementById("m-ok").onclick = function () {
      var phone = document.getElementById("m-phone").value.trim();
      var typed = document.getElementById("m-name").value.trim();
      var known = knownName(phone);
      var name = known || typed;
      if (!name) { toast(phone ? "That number is not registered yet, add their name" : "Add their name or phone"); return; }
      var rec = { name: name, relation: document.getElementById("m-rel").value.trim(), phone: phone, kind: idx === 0 ? "Primary" : "Secondary" };
      state.caregivers[idx] = rec;
      syncPrimaryContact();
      persist(); closeModal(); render();
      toast(known ? "Linked " + name.split(" ")[0] : "Saved");
    };
  }
  function syncPrimaryContact() {
    if (!isCg() && state.caregivers && state.caregivers.length) state.contact = state.caregivers[0];
  }

  /* caregiver role: link another person to care for (demo approval) */
  function addPatientModal() {
    openModal("<h3>Add someone to care for</h3>" +
      "<p>Enter their phone number. If it is a registered account we pull their name, otherwise add it below. We send a link request they approve on their own device.</p>" +
      '<div class="field"><label>Their phone</label><input id="m-phone" type="tel" placeholder="e.g. 555-0182"></div>' +
      '<div class="field"><label>Their name</label><input id="m-name" placeholder="Auto-filled if registered"></div>' +
      '<div class="field"><label>Relationship</label><input id="m-rel" placeholder="e.g. Father"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take" id="m-ok">Send link request</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = function () {
      var phone = document.getElementById("m-phone").value.trim();
      if (!phone) { toast("Add their phone number"); return; }
      var typed = document.getElementById("m-name").value.trim();
      var known = knownName(phone);
      if (!typed && !known) { toast("That number is not registered yet, add their name"); return; }
      var name = known || typed;
      var first = name.split(" ")[0];
      var rec = {
        id: uid(), name: name, phone: phone,
        relation: document.getElementById("m-rel").value.trim() || "Patient",
        meds: [], log: {}, feed: [], profile: null
      };
      state.patients = state.patients || [];
      state.patients.push(rec);
      save(KEYS.patients, state.patients);
      closeModal();
      toast("Link request sent to " + first);
      render(); // show them in the list right away (pending)
      /* demo: they approve a moment later */
      setTimeout(function () {
        toast(first + " approved the request");
        render();
      }, 1400);
    };
  }

  /* 2FA gate for the health profile (demo code 0000) */
  function openProfileGate() {
    if (state.profileUnlocked) { state.view = "profile"; render(); return; }
    openModal("<h3>Verify it’s you</h3>" +
      "<p>The health profile holds sensitive medical and insurance details. Enter the 4-digit code we texted you. Demo code: <b>0000</b>.</p>" +
      '<div class="otp-row otp-modal">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric" autocomplete="one-time-code">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
      "</div>" +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take" id="m-ok">Unlock</button></div>');
    var boxes = Array.prototype.slice.call(modalEl.querySelectorAll(".otp-box"));
    function code() { return boxes.map(function (b) { return b.value; }).join(""); }
    function verify() {
      if (code() === "0000") { state.profileUnlocked = true; closeModal(); state.view = "profile"; render(); toast("Verified"); }
      else { toast("That code didn’t match. Try 0000"); boxes.forEach(function (b) { b.value = ""; }); boxes[0].focus(); }
    }
    boxes.forEach(function (b, i) {
      b.addEventListener("input", function () {
        b.value = b.value.replace(/\D/g, "").slice(0, 1);
        if (b.value && i < 3) boxes[i + 1].focus();
        if (code().length === 4) verify();
      });
      b.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !b.value && i > 0) boxes[i - 1].focus();
        if (e.key === "Enter") verify();
      });
    });
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = verify;
    boxes[0].focus();
  }

  function confirmReset() {
    openModal("<h3>Reset everything?</h3><p>All medications, history and settings return to the demo example.</p>" +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-take m-danger" id="m-ok">Reset</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-ok").onclick = function () { localStorage.clear(); location.reload(); };
  }

  function switchRole() {
    obPhoneNum = state.user && state.user.phone ? state.user.phone : "";
    obPeople = null; obCgName = "";
    state.user = null;
    localStorage.removeItem(KEYS.user);
    state.view = "home"; state.calOpen = false;
    showOnboarding();
  }

  /* ---------------- contact actions ---------------- */
  function summaryText() {
    var c = counts(new Date());
    var missed = dosesForDate(new Date()).filter(function (x) { return x.status === "missed"; });
    var who = isCg() ? whoName() : (state.user && state.user.name ? state.user.name : "me");
    return "DoseGuide daily summary for " + who + "\n" +
      "Taken " + c.taken + " of " + c.total + " doses" +
      (missed.length ? "\nMissed: " + missed.map(function (x) { return x.med.name + " at " + fmtTime(x.time); }).join(", ")
                     : "\nNo missed doses.");
  }
  function shareToday() {
    var txt = summaryText();
    openModal("<h3>Share summary</h3><p>How would you like to send today’s update?</p>" +
      '<div class="share-opts">' +
        '<button class="share-opt" data-share="sms">' + ic("chat") + "<span>Message</span></button>" +
        '<button class="share-opt" data-share="email">' + ic("clip") + "<span>Email</span></button>" +
        '<button class="share-opt" data-share="whatsapp">' + ic("phone") + "<span>WhatsApp</span></button>" +
      "</div>" +
      '<div class="modal-actions"><button class="btn btn-quiet" id="m-cancel">Cancel</button></div>');
    document.getElementById("m-cancel").onclick = closeModal;
    [].slice.call(modalEl.querySelectorAll("[data-share]")).forEach(function (b) {
      b.onclick = function () {
        var ch = b.getAttribute("data-share"), enc = encodeURIComponent(txt);
        var url = ch === "sms" ? "sms:?body=" + enc
          : ch === "email" ? "mailto:?subject=" + encodeURIComponent("DoseGuide summary") + "&body=" + enc
          : "https://wa.me/?text=" + enc;
        var label = ch === "sms" ? "Messages" : ch === "email" ? "email" : "WhatsApp";
        closeModal();
        toast("Opening " + label);
        if (ch === "whatsapp") window.open(url, "_blank"); else window.location.href = url;
      };
    });
  }
  function callContact(emergency) {
    var c = emergencyCaregiver();
    if (c && c.phone) {
      if (emergency) toast("Calling " + c.name + " now");
      window.location.href = "tel:" + c.phone;
    } else { toast("Add a contact first"); state.view = "care"; render(); }
  }

  /* ---------------- reminders ---------------- */
  var timers = [];
  function requestNotify() {
    if (!("Notification" in window)) { toast("This browser can’t show reminders"); return; }
    function enable() { state.settings.remindersOn = true; save(KEYS.settings, state.settings); scheduleReminders(); render(); toast("Reminders are on"); }
    if (Notification.permission === "granted") { enable(); return; }
    Notification.requestPermission().then(function (p) {
      if (p === "granted") enable();
      else toast("Reminders were blocked in the browser");
    });
  }
  function scheduleReminders() {
    timers.forEach(clearTimeout); timers = [];
    if (!bellOn()) return;
    var now = new Date();
    dosesForDate(now).forEach(function (x) {
      if (x.status !== "due" && x.status !== "upcoming") return;
      var p = x.time.split(":"), when = new Date();
      when.setHours(+p[0], +p[1], 0, 0);
      var delay = when - now;
      if (delay > 0 && delay < 86400000) {
        timers.push(setTimeout(function () {
          new Notification((isCg() ? whoName() + "’s dose: " : "Time for ") + x.med.name, { body: x.med.dosage + " · " + fmtTime(x.time) });
        }, delay));
      }
    });
  }

  /* ---------------- toast ---------------- */
  var toastEl = document.getElementById("toast"), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  /* ============================================================
     ONBOARDING, role fork
     ============================================================ */
  var onboard = document.getElementById("onboard");
  var obPhoneNum = "";
  function obBrand() { return '<div class="ob-brand">DoseGuide</div>'; }

  function showOnboarding() {
    /* clear the app behind the overlay so the page can't scroll into empty space */
    screen.innerHTML = "";
    tabbar.style.display = "none";
    onboard.hidden = false;
    obSplash();
  }

  /* --- splash: the quick Rx screen that fades into sign-in --- */
  function obSplash() {
    onboard.innerHTML =
      '<div class="ob-splash" id="ob-splash">' +
        '<div class="ob-mark ob-mark-lg">℞</div>' +
        '<div class="ob-splash-name">DoseGuide</div>' +
        '<div class="ob-splash-tag">Every dose, on time</div>' +
      "</div>";
    var advanced = false;
    function go() { if (advanced) return; advanced = true; obAuth(); }
    var sp = document.getElementById("ob-splash");
    if (sp) sp.addEventListener("click", go);
    setTimeout(go, 1900);
  }

  /* --- step 0: phone sign-in --- */
  function obAuth() {
    onboard.innerHTML =
      obBrand() +
      '<h1 class="ob-title">Welcome<br><em>back.</em></h1>' +
      '<p class="ob-sub">Sign in with your phone number. Your schedule stays yours, on your device.</p>' +
      '<div class="field"><label>Phone number</label><input id="ob-phone" type="tel" inputmode="tel" placeholder="(555) 014-2000" value="' + esc(obPhoneNum) + '" autocomplete="tel"></div>' +
      '<button class="btn-primary" id="ob-send">Send verification code</button>' +
      '<p class="hint" style="text-align:center;margin-top:12px">Demo build: enter any 10 digits, or the registered account <b>0000000000</b> to sign in as Rashmi.</p>';
    var input = document.getElementById("ob-phone");
    function send() {
      var v = input.value.trim();
      if (v.replace(/\D/g, "").length !== 10) { toast("Enter a 10-digit phone number"); return; }
      obPhoneNum = v;
      toast("Code sent to " + v);
      obOtp();
    }
    document.getElementById("ob-send").onclick = send;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
    input.focus();
  }

  /* --- step 0b: OTP verification (demo code 0000) --- */
  function obOtp() {
    var kn = knownName(obPhoneNum);
    onboard.innerHTML =
      obBrand() +
      '<h1 class="ob-title">' + (kn ? "Welcome back,<br><em>" + esc(kn.split(" ")[0]) + ".</em>" : "Enter your<br><em>code.</em>") + "</h1>" +
      '<p class="ob-sub">' + (kn ? "We recognized your number. " : "") + "We texted a 4-digit code to <b>" + esc(obPhoneNum) + "</b>.<br>Demo build: the code is <b>0000</b>.</p>" +
      '<div class="otp-row">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric" autocomplete="one-time-code">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
        '<input class="otp-box" maxlength="1" inputmode="numeric">' +
      "</div>" +
      '<button class="btn-primary" id="ob-verify">Verify</button>' +
      '<button class="ob-back" id="ob-resend">Resend code</button>' +
      '<button class="ob-back" id="ob-back">← Different number</button>';

    var boxes = Array.prototype.slice.call(onboard.querySelectorAll(".otp-box"));
    function code() { return boxes.map(function (b) { return b.value; }).join(""); }
    function verify() {
      if (code() === "0000") { toast("Verified"); obStep1(); }
      else {
        toast("That code didn’t match. Try 0000");
        boxes.forEach(function (b) { b.value = ""; });
        boxes[0].focus();
      }
    }
    boxes.forEach(function (b, i) {
      b.addEventListener("input", function () {
        b.value = b.value.replace(/\D/g, "").slice(0, 1);
        if (b.value && i < 3) boxes[i + 1].focus();
        if (code().length === 4) verify();
      });
      b.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !b.value && i > 0) boxes[i - 1].focus();
        if (e.key === "Enter") verify();
      });
    });
    document.getElementById("ob-verify").onclick = verify;
    document.getElementById("ob-resend").onclick = function () { toast("New code sent, it’s still 0000"); };
    document.getElementById("ob-back").onclick = obAuth;
    boxes[0].focus();
  }
  function obStep1() {
    var kn = knownName(obPhoneNum);
    onboard.innerHTML =
      obBrand() +
      '<h1 class="ob-title">' + (kn ? "Hello again,<br><em>" + esc(kn.split(" ")[0]) + ".</em>" : "One calm<br><em>place.</em>") + "</h1>" +
      '<p class="ob-sub">' + (kn ? "Signed in as " + esc(kn) + ". How are you using DoseGuide today?" : "Medication schedules, supply and caregivers, all together. First, who are you?") + "</p>" +
      '<div class="role-cards">' +
        '<button class="role-card" id="ob-patient">' +
          '<span class="role-ico">' + ic("user") + "</span>" +
          "<span><b>I take medications</b><span>Reminders, refills and a caregiver by your side.</span></span></button>" +
        '<button class="role-card" id="ob-cg">' +
          '<span class="role-ico">' + ic("heart") + "</span>" +
          "<span><b>I care for someone</b><span>Watch over their doses, get alerts, stay close.</span></span></button>" +
      "</div>";
    document.getElementById("ob-patient").onclick = function () { obPatientSetup(); };
    document.getElementById("ob-cg").onclick = function () { obCarePeople(); };
  }

  /* patient setup */
  function obPatientSetup() {
    /* a registered account already has a name, so never ask for it again */
    var kn = knownName(obPhoneNum);
    if (kn) { finishPatient(kn, true); return; }
    onboard.innerHTML =
      obBrand() +
      '<h1 class="ob-title">Let’s make it<br><em>effortless.</em></h1>' +
      '<p class="ob-sub">A sample cabinet is loaded so you can explore right away.</p>' +
      '<div class="field"><label>Your first name</label><input id="ob-name" placeholder="e.g. Emily" autocomplete="given-name"></div>' +
      '<button class="btn-primary" id="ob-go">Begin</button>' +
      '<button class="ob-back" id="ob-back">← Back</button>';
    document.getElementById("ob-back").onclick = obStep1;
    document.getElementById("ob-go").onclick = function () {
      finishPatient(document.getElementById("ob-name").value.trim(), false);
    };
  }
  function finishPatient(name, returning) {
    state.user = { name: name || "", role: "patient", patient: "", phone: obPhoneNum };
    save(KEYS.user, state.user);
    if (!state.caregivers || !state.caregivers.length) {
      state.caregivers = [
        { name: "Jacob Daga", relation: "Son", phone: "555-0142", kind: "Primary" },
        { name: "Priya Nair", relation: "Neighbor", phone: "555-0163", kind: "Secondary" }
      ];
    }
    state.contact = state.caregivers[0];
    persist();
    onboard.hidden = true; onboard.innerHTML = "";
    renderTabbar(); render();
    var first = name ? name.split(" ")[0] : "";
    toast(first ? (returning ? "Welcome back, " + first : "Welcome, " + first) : "Welcome to DoseGuide");
  }

  /* caregiver setup: manage the people you care for, then continue */
  var obPeople = null;
  var obCgName = "";
  function obCarePeople() {
    if (!obPeople) obPeople = [
      { kind: "emily", name: "Emily Parker", phone: "555-0117", relation: "Mother" },
      { kind: "robert", name: "Robert Hayes", phone: "555-0182", relation: "Father" }
    ];
    if (!obCgName) obCgName = knownName(obPhoneNum) || "";
    renderCarePeople();
  }
  /* the name field is hidden for registered accounts, so read it safely */
  function cgNameVal() {
    var e = document.getElementById("ob-name");
    return e ? e.value.trim() : obCgName;
  }
  function renderCarePeople() {
    var rows = obPeople.map(function (p, i) {
      return '<div class="care-person"><div class="avatar">' + esc(initialsOf(p.name)) + "</div>" +
        '<div style="flex:1;min-width:0"><b>' + esc(p.name) + "</b><span>" + esc(p.relation || "") +
        (p.phone ? " · " + esc(p.phone) : "") + "</span></div>" +
        '<span class="badge taken">Linked</span>' +
        (obPeople.length > 1 ? '<button class="mini-btn danger" data-rm="' + i + '" title="Remove">×</button>' : "") +
        "</div>";
    }).join("");
    /* a registered account already has a name, so never ask for it again */
    var kn = knownName(obPhoneNum);
    onboard.innerHTML =
      obBrand() +
      '<h1 class="ob-title">People you<br><em>care for.</em></h1>' +
      '<p class="ob-sub">' + (kn ? "Signed in as " + esc(kn) + ". These accounts are linked to you." : "These accounts are linked to you.") +
        " Add anyone else, then continue.</p>" +
      (kn ? "" : '<div class="field"><label>Your first name</label><input id="ob-name" placeholder="e.g. Jacob" autocomplete="given-name" value="' + esc(obCgName) + '"></div>') +
      '<div class="ob-people">' + rows + "</div>" +
      '<div class="ob-addrow"><input id="ob-add-phone" type="tel" placeholder="Phone number"><input id="ob-add-name" placeholder="Name"><button id="ob-add">Add</button></div>' +
      '<div class="hint" style="margin:8px 0 2px">Enter a phone number. If it is a registered account we pull the name for you.</div>' +
      '<button class="btn-primary" id="ob-go">Continue</button>' +
      '<button class="ob-back" id="ob-back">← Back</button>';
    document.getElementById("ob-back").onclick = obStep1;
    document.getElementById("ob-add").onclick = function () {
      obCgName = cgNameVal();
      var n = document.getElementById("ob-add-name").value.trim();
      var ph = document.getElementById("ob-add-phone").value.trim();
      if (!ph) { toast("Add their phone number"); return; }
      var known = knownName(ph);
      if (!n && !known) { toast("That number is not registered yet, add their name"); return; }
      var finalName = known || n;
      obPeople.push({ kind: "new", name: finalName, phone: ph, relation: "Patient" });
      var first = finalName.split(" ")[0];
      toast(known ? "Found " + first + ", link request sent" : "Link request sent to " + first);
      setTimeout(function () { toast(first + " approved the request"); }, 1200);
      renderCarePeople();
    };
    [].slice.call(onboard.querySelectorAll("[data-rm]")).forEach(function (b) {
      b.onclick = function () {
        var idx = +b.getAttribute("data-rm");
        var nm = obPeople[idx] ? obPeople[idx].name : "this person";
        obCgName = cgNameVal();
        openModal("<h3>Remove " + esc(nm) + "?</h3><p>They will be unlinked from your account.</p>" +
          '<div class="modal-actions"><button class="btn btn-quiet" id="m-cancel">Keep</button>' +
          '<button class="btn btn-take m-danger" id="m-ok">Remove</button></div>');
        document.getElementById("m-cancel").onclick = closeModal;
        document.getElementById("m-ok").onclick = function () { obPeople.splice(idx, 1); closeModal(); renderCarePeople(); };
      };
    });
    document.getElementById("ob-go").onclick = function () {
      finishCaregiver(cgNameVal() || knownName(obPhoneNum) || "");
    };
  }
  function finishCaregiver(name) {
    state.user = { name: name || "", role: "caregiver", patient: obPeople[0].name, phone: obPhoneNum };
    save(KEYS.user, state.user);
    state.patients = obPeople.map(function (p) {
      if (p.kind === "emily") return { id: uid(), name: p.name, phone: p.phone, relation: p.relation, meds: state.meds, log: state.log, feed: state.feed, profile: state.profile };
      if (p.kind === "robert") { var r = buildSecondPatient(); r.name = p.name; r.phone = p.phone; r.relation = p.relation; return r; }
      return { id: uid(), name: p.name, phone: p.phone, relation: p.relation || "Patient", meds: [], log: {}, feed: [], profile: null };
    });
    state.activePatient = state.patients[0].id;
    loadPatient(state.activePatient);
    save(KEYS.patients, state.patients); save(KEYS.active, state.activePatient);
    save(KEYS.contact, state.contact); save(KEYS.meds, state.meds); save(KEYS.log, state.log);
    save(KEYS.feed, state.feed); save(KEYS.profile, state.profile);
    onboard.hidden = true; onboard.innerHTML = "";
    renderTabbar(); render();
    toast(name ? "Welcome, " + name.split(" ")[0] : "Welcome to DoseGuide");
  }

  /* ---------------- live countdown tick ---------------- */
  setInterval(function () {
    if (state.view !== "home" || !modalWrap.hidden || !onboard.hidden) return;
    var nx = nextDose(), cd = document.getElementById("countdown");
    if (nx && cd) cd.textContent = countdownText(nx.time);
    else render();
  }, 30000);

  /* ---------------- boot ---------------- */
  if (isCg() && state.patients && state.patients.length) {
    var hasActive = false;
    for (var bi = 0; bi < state.patients.length; bi++) if (state.patients[bi].id === state.activePatient) hasActive = true;
    loadPatient(hasActive ? state.activePatient : state.patients[0].id);
  }
  renderTabbar();
  if (bellOn()) scheduleReminders();
  if (state.user) render();
  else showOnboarding();
})();
