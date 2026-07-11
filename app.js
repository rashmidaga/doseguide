/* ============================================================
   DoseGuide — application logic
   Two experiences over one dose engine:
     · Patient   — Today / Meds / + / Refills / Care
     · Caregiver — Overview / Meds / + / Refills / Connect
   Vanilla JS, localStorage, zero dependencies.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- storage ---------------- */
  var KEYS = { user: "dg3.user", meds: "dg3.meds", log: "dg3.log", contact: "dg3.contact", feed: "dg3.feed", profile: "dg3.profile", seeded: "dg3.seeded" };
  function load(k, fb) { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch (e) { return fb; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  var state = {
    user: load(KEYS.user, null),          // { name, role: 'patient'|'caregiver', patient, phone }
    meds: load(KEYS.meds, []),
    log: load(KEYS.log, {}),              // { 'YYYY-MM-DD': { 'medId@HH:MM': 'taken'|'skipped' } }
    contact: load(KEYS.contact, null),    // the other person (caregiver OR patient)
    feed: load(KEYS.feed, []),            // [{t, txt}]
    profile: load(KEYS.profile, null),    // the patient's health record
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
  }

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
      { id: uid(), name: "Lisinopril", dosage: "10 mg · 1 tablet", instructions: "With water, before breakfast", times: ["09:00"], pillsLeft: 8,  pillsPerDose: 1 },
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
      { t: Date.now() - 26 * 3600e3, txt: "Emily took Metformin — evening dose" },
      { t: Date.now() - 20 * 3600e3, txt: "Refill reminder sent for Lisinopril" }
    ];
    persist();
    localStorage.setItem(KEYS.seeded, "1");
  }

  /* Default health record (idempotent — also fills older installs) */
  if (!state.profile) {
    state.profile = {
      dob: "1956-03-14",
      blood: "O+",
      conditions: ["Hypertension", "Type 2 diabetes", "High cholesterol"],
      allergies: ["Penicillin", "Sulfa drugs"],
      notes: "Mild arthritis in both hands — prefers easy-open caps.",
      physician: { name: "Dr. Sarah Chen", practice: "Beacon Hill Primary Care", phone: "555-0198" },
      pharmacy: { name: "CVS Pharmacy — Main St", phone: "555-0175" },
      insurance: { provider: "Blue Cross Blue Shield MA", plan: "Medicare Advantage PPO", memberId: "XQH482915530", group: "MA-77821", phone: "1-800-262-2583" },
      contacts: [
        { name: "Jacob Daga", relation: "Son", phone: "555-0142" },
        { name: "Priya Nair", relation: "Neighbor", phone: "555-0163" }
      ]
    };
    save(KEYS.profile, state.profile);
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
  function lowStock() { return state.meds.filter(function (m) { return daysOfSupply(m) <= 5; }); }

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
    if (status === "taken") toast(isCg() ? "Confirmed — " + whoName() + " took " + (med ? med.name : "the dose") : "Dose recorded — beautifully done");
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
  function bellOn() { return ("Notification" in window) && Notification.permission === "granted"; }

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
        '<div class="dose-meta">' + esc(m.dosage) + (m.instructions ? " — " + esc(m.instructions) : "") + "</div></div>" +
        badge + "</div>" +
      '<div class="dose-actions">' + actions + "</div></div></div>";
  }

  function emptyState(icon, title, sub) {
    return '<div class="empty"><div class="glyph">' + ic(icon) + "</div><h3>" + title + "</h3><p>" + sub + "</p></div>";
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
    h += state.calOpen ? monthPanel() : weekStrip();

    if (today && c.total > 0) {
      var nx = nextDose();
      if (nx) {
        h += '<section class="focus"><div class="focus-row">' + ringSvg(pct) +
          '<div class="focus-info">' +
            '<div class="focus-eyebrow"><span class="pulse"></span>Up next</div>' +
            '<div class="focus-name">' + esc(nx.med.name) + "</div>" +
            '<div class="focus-meta">' + esc(nx.med.dosage) + "</div>" +
            '<div class="focus-when">' + fmtTime(nx.time) + " <b id='countdown'>" + countdownText(nx.time) + "</b></div>" +
          "</div></div>" +
          '<button class="focus-cta" data-act="take" data-key="' + nx.doseKey + '" data-med="' + nx.med.id + '">' +
            ic("check") + "Take " + esc(nx.med.name) + " now</button></section>";
      } else {
        h += '<section class="focus focus-done"><div class="focus-row">' + ringSvg(pct) +
          '<div class="focus-info">' +
            '<div class="focus-eyebrow">' + ic("moon") + "Schedule complete</div>" +
            '<div class="focus-name">All clear</div>' +
            '<div class="focus-meta">Every remaining dose is accounted for. Rest easy — DoseGuide is watching the clock.</div>' +
          "</div></div></section>";
      }
    }

    /* one-touch emergency (PRD: patient MVP) */
    if (state.contact) {
      h += '<button class="sos sos-slim" data-act="sos">' + ic("siren") +
        "Emergency — call " + esc(state.contact.name.split(" ")[0]) + "</button>";
    }

    if (low.length) {
      h += '<div class="notice"><div class="n-ico">' + ic("box") + "</div><div>" +
        "<h4>Refill running low</h4><p>" +
        low.map(function (m) { return esc(m.name) + " — " + daysOfSupply(m) + " days left"; }).join(" · ") +
        "</p></div><button data-act=\"goto\" data-view=\"refills\">Review →</button></div>";
    }

    if (c.total) h += statBand(c, ["Taken", "Missed", "Remaining"]);

    if (!list.length) return h + emptyState("pill", "Nothing scheduled", "Tap the + button below to add your first medication.");

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
    h += state.calOpen ? monthPanel() : weekStrip();

    /* patient status card */
    var nx = today ? nextDose() : null;
    var statusLine = c.taken + " of " + c.total + " doses taken" +
      (nx ? " · next " + esc(nx.med.name) + " at " + fmtTime(nx.time) : "");
    h += '<section class="focus"><div class="focus-row">' + ringSvg(pct) +
      '<div class="focus-info">' +
        '<div class="focus-eyebrow"><span class="pulse"></span>' + esc(them) + " — live</div>" +
        (nx
          ? '<div class="focus-name">' + esc(nx.med.name) + '</div>' +
            '<div class="focus-meta">' + statusLine + "</div>" +
            '<div class="focus-when">' + fmtTime(nx.time) + " <b id='countdown'>" + countdownText(nx.time) + "</b></div>"
          : '<div class="focus-name">All handled</div>' +
            '<div class="focus-meta">' + statusLine + "</div>") +
      "</div></div>" +
      '<div class="focus-actions">' +
        '<button class="focus-cta" data-act="nudge">' + ic("send") + "Send " + esc(them) + " a reminder</button>" +
        '<button class="btn-dark" data-act="call" title="Call">' + ic("phone") + "</button>" +
      "</div></section>";

    /* needs-attention feed */
    var missed = list.filter(function (x) { return x.status === "missed"; });
    if (missed.length || low.length) {
      h += '<div class="tl-head">Needs attention</div>';
      missed.forEach(function (x) {
        h += '<div class="notice danger"><div class="n-ico">' + ic("alert") + "</div><div>" +
          "<h4>Missed — " + esc(x.med.name) + " at " + fmtTime(x.time) + "</h4>" +
          "<p>No confirmation from " + esc(them) + " yet.</p></div>" +
          '<button data-act="nudge" data-med="' + x.med.id + '">Nudge →</button></div>';
      });
      low.forEach(function (m) {
        h += '<div class="notice"><div class="n-ico">' + ic("box") + "</div><div>" +
          "<h4>" + esc(m.name) + " running low</h4><p>" + m.pillsLeft + " pills · about " + daysOfSupply(m) + " days left.</p></div>" +
          '<button data-act="goto" data-view="refills">Order →</button></div>';
      });
    } else if (c.total) {
      h += '<div class="notice ok"><div class="n-ico">' + ic("check") + "</div><div>" +
        "<h4>All on track</h4><p>No missed doses and supplies look healthy.</p></div></div>";
    }

    if (c.total) h += statBand(c, ["Taken", "Missed", "Remaining"]);

    if (!list.length) return h + emptyState("pill", "No medications yet", "Add " + esc(them) + "’s medications with the + button.");

    h += '<div class="tl-head">' + esc(them) + "’s schedule</div>";
    h += '<div class="tl">';
    list.forEach(function (x) { h += tlRow(x); });
    return h + "</div>";
  }

  /* ============================================================
     MEDS / ADD / REFILLS (shared)
     ============================================================ */
  function viewMeds() {
    var owner = isCg() ? whoName() + "’s cabinet" : "Your cabinet";
    var h = masthead(owner, "Medications");
    if (!state.meds.length) return h + emptyState("pill", "No medications yet", "Tap + to add the first one.");
    state.meds.forEach(function (m) {
      var days = daysOfSupply(m), low = days <= 5;
      h += '<div class="medcard"><div class="medcard-top">' + pillDot(m) +
        '<div class="medcard-info"><div class="medcard-name">' + esc(m.name) + "</div>" +
        '<div class="medcard-meta">' + esc(m.dosage) + " · " + m.times.map(fmtTime).join(", ") + "</div></div>" +
        '<button class="link-btn" data-act="edit" data-med="' + m.id + '">Edit</button></div>' +
        '<div class="stock' + (low ? " low" : "") + '"><div class="stock-row"><span>' + m.pillsLeft +
          ' pills on hand</span><span class="stock-days">' + days + " days</span></div>" +
        '<div class="stock-bar"><span style="width:' + Math.min(100, days * 4) + '%"></span></div></div></div>';
    });
    return h;
  }

  var tempTimes = [];
  function viewAdd(editing) {
    var m = editing || { name: "", dosage: "", instructions: "", times: ["09:00"], pillsLeft: 30 };
    tempTimes = m.times.slice();
    var h = masthead(editing ? "Edit" : "New medication", editing ? esc(m.name) : "Add a <em>medication</em>");
    h += '<div class="field"><label>Name</label><input id="f-name" placeholder="e.g. Lisinopril" value="' + esc(m.name) + '"></div>' +
      '<div class="field"><label>Dosage</label><input id="f-dosage" placeholder="e.g. 10 mg · 1 tablet" value="' + esc(m.dosage) + '"></div>' +
      '<div class="field"><label>Instructions · optional</label>' +
        '<input id="f-inst" placeholder="e.g. With food" value="' + esc(m.instructions) + '"></div>' +
      '<div class="field"><label>Dose times</label><div class="times" id="time-list"></div>' +
        '<div class="add-time"><input type="time" id="f-time" value="09:00"><button data-act="addtime">Add</button></div>' +
        '<div class="hint">Add every time of day this is taken — reminders follow this schedule.</div></div>' +
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
      : '<span class="hint">No times yet — add one below.</span>';
  }

  function viewRefills() {
    var h = masthead("Supply", "Refills");
    var low = lowStock();
    if (low.length) {
      h += '<div class="notice danger"><div class="n-ico">' + ic("alert") + "</div><div>" +
        "<h4>" + low.length + " medication" + (low.length > 1 ? "s" : "") + " running low</h4>" +
        "<p>Order refills soon to avoid an interruption.</p></div></div>";
    }
    if (!state.meds.length) return h + emptyState("box", "Nothing to track", "Add a medication first — supply tracking starts automatically.");
    state.meds.slice().sort(function (a, b) { return daysOfSupply(a) - daysOfSupply(b); }).forEach(function (m) {
      var days = daysOfSupply(m), low2 = days <= 5;
      h += '<div class="medcard"><div class="medcard-top">' + pillDot(m) +
        '<div class="medcard-info"><div class="medcard-name">' + esc(m.name) + "</div>" +
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
  function viewCare() {
    if (isCg()) return viewConnect();
    var c = state.contact;
    var h = masthead("Circle of care", "Care &amp; settings");

    h += '<div class="card"><h3>' + ic("heart") + "Caregiver</h3>" +
      '<p class="muted">Your caregiver can receive a daily summary and be reached instantly in an emergency.</p>';
    if (c) {
      h += personRow(c) +
        '<div class="dose-actions">' +
          '<button class="btn btn-take" data-act="share">' + ic("share") + "Share today</button>" +
          '<button class="btn btn-quiet" data-act="call">' + ic("phone") + "Call</button></div>" +
        '<button class="link-btn" data-act="editcontact" style="margin-top:10px">Edit caregiver</button>';
    } else {
      h += '<button class="btn-primary" data-act="editcontact">Add a caregiver</button>';
    }
    h += "</div>";

    h += '<div class="card"><div class="card-head"><h3>' + ic("clip") + "My health profile</h3>" +
      '<button class="link-btn" data-act="goto" data-view="profile">Open →</button></div>' +
      '<p class="muted" style="margin:0">Medical history, insurance and emergency contacts — ready whenever a doctor or pharmacist asks.</p></div>';

    h += remindersCard();
    h += '<button class="sos" data-act="sos">' + ic("siren") + "Emergency — call caregiver</button>";
    h += dataCard();
    return h;
  }

  function viewConnect() {
    var c = state.contact;
    var them = whoName();
    var h = masthead("Stay close", "Connect");

    h += '<div class="card"><h3>' + ic("user") + esc(them) + "</h3>" +
      '<p class="muted">Your patient — one tap away.</p>';
    if (c) {
      h += personRow(c) +
        '<div class="dose-actions">' +
          '<button class="btn btn-take" data-act="call">' + ic("phone") + "Call " + esc(them) + "</button>" +
          '<button class="btn btn-quiet" data-act="share">' + ic("share") + "Share summary</button></div>" +
        '<div class="rowlinks">' +
          '<button class="link-btn" data-act="goto" data-view="profile">Full health profile →</button>' +
          '<button class="link-btn" data-act="editcontact">Edit contact</button></div>';
    } else {
      h += '<button class="btn-primary" data-act="editcontact">Add your patient</button>';
    }
    h += "</div>";

    h += '<div class="card"><h3>' + ic("chat") + "Quick messages</h3>" +
      '<p class="muted">One-tap notes that appear on ' + esc(them) + "’s phone.</p>" +
      '<div class="chips">' +
        '<button class="chip" data-act="msg" data-txt="Time for your medicine">Time for your medicine</button>' +
        '<button class="chip" data-act="msg" data-txt="How are you feeling today?">How are you feeling today?</button>' +
        '<button class="chip" data-act="msg" data-txt="Your refill is ordered">Your refill is ordered</button>' +
        '<button class="chip" data-act="msg" data-txt="Calling you in 5 minutes">Calling you in 5 minutes</button>' +
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
    h += dataCard();
    return h;
  }

  function personRow(c) {
    var initials = c.name.split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
    return '<div class="care-person"><div class="avatar">' + esc(initials) + "</div>" +
      "<div><b>" + esc(c.name) + "</b><span>" + esc(c.relation || "") + (c.relation && c.phone ? " · " : "") + esc(c.phone || "") + "</span></div></div>";
  }
  function remindersCard() {
    return '<div class="card"><h3>' + ic("bell") + "Reminders</h3>" +
      '<p class="muted">A gentle notification at each dose time while DoseGuide is open.</p>' +
      '<button class="btn-primary" data-act="notify">' + (bellOn() ? "Reminders are on" : "Turn on reminders") + "</button>" +
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
      h += '<p class="muted" style="margin:0">No contacts yet — add at least one.</p>';
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
      mField("Pharmacy", "m-ph", p.pharmacy.name, "e.g. CVS — Main St") +
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
      tabBtn("home", cg ? "Overview" : "Today", cg ? "grid" : "home") +
      tabBtn("meds", "Meds", "pill") +
      '<button class="tab tab-add" data-view="add" aria-label="Add medication"><span class="plus">' + ic("plus") + "</span></button>" +
      tabBtn("refills", "Refills", "box") +
      tabBtn("care", cg ? "Connect" : "Care", cg ? "chat" : "heart");
    syncTabs();
  }

  function render() {
    var v = state.view, html = "";
    if (v === "home") html = isCg() ? viewCaregiverHome() : viewPatientHome();
    else if (v === "meds") html = viewMeds();
    else if (v === "add") html = viewAdd(null);
    else if (v === "edit") html = viewAdd(state.editing);
    else if (v === "refills") html = viewRefills();
    else if (v === "care") html = viewCare();
    else if (v === "profile") html = viewProfile();
    screen.innerHTML = '<div class="view">' + html + "</div>";
    if (v === "add" || v === "edit") renderChips();
    if (v === "home") {
      var c = counts(state.selectedDate);
      animateRing(c.total ? Math.round((c.taken / c.total) * 100) : 0);
    }
    syncTabs();
    screen.scrollTop = 0;
  }
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (el) {
      var v = el.getAttribute("data-view");
      el.classList.toggle("is-active", v === state.view || (state.view === "edit" && v === "meds") || (state.view === "profile" && v === "care"));
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
    else if (act === "edit") { state.editing = medById(medId); state.view = "edit"; render(); }
    else if (act === "addtime") {
      var v = document.getElementById("f-time").value;
      if (v && tempTimes.indexOf(v) === -1) { tempTimes.push(v); renderChips(); }
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
    else if (act === "notify") requestNotify();
    else if (act === "reset") confirmReset();
    else if (act === "switchrole") switchRole();
    else if (act === "nudge") {
      var mN = medId ? medById(medId) : null;
      var who = whoName();
      pushFeed("You nudged " + who + (mN ? " about " + mN.name : ""));
      toast("Reminder sent to " + who + (mN ? " — " + mN.name : ""));
      if (state.view === "care") render();
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
    var data = {
      name: name,
      dosage: document.getElementById("f-dosage").value.trim(),
      instructions: document.getElementById("f-inst").value.trim(),
      times: tempTimes.slice(),
      pillsLeft: isNaN(pills) ? 0 : pills,
      pillsPerDose: 1
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
        persist(); closeModal(); render(); toast(m.name + " restocked — " + m.pillsLeft + " pills");
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
    state.user = null;
    localStorage.removeItem(KEYS.user);
    state.view = "home"; state.calOpen = false;
    showOnboarding();
  }

  /* ---------------- contact actions ---------------- */
  function shareToday() {
    var c = counts(new Date());
    var missed = dosesForDate(new Date()).filter(function (x) { return x.status === "missed"; });
    var who = isCg() ? whoName() : (state.user && state.user.name ? state.user.name : "me");
    var txt = "DoseGuide daily summary for " + who + "\n" +
      "Taken " + c.taken + " of " + c.total + " doses" +
      (missed.length ? "\nMissed: " + missed.map(function (x) { return x.med.name + " at " + fmtTime(x.time); }).join(", ")
                     : "\nNo missed doses.");
    if (navigator.share) navigator.share({ title: "DoseGuide summary", text: txt }).catch(function () {});
    else if (navigator.clipboard) { navigator.clipboard.writeText(txt); toast("Summary copied to clipboard"); }
    else alert(txt);
  }
  function callContact(emergency) {
    var c = state.contact;
    if (c && c.phone) {
      if (emergency) toast("Calling " + c.name + " now");
      window.location.href = "tel:" + c.phone;
    } else { toast("Add a contact first"); state.view = "care"; render(); }
  }

  /* ---------------- reminders ---------------- */
  var timers = [];
  function requestNotify() {
    if (!("Notification" in window)) { toast("This browser can’t show reminders"); return; }
    if (Notification.permission === "granted") { toast("Reminders are already on"); return; }
    Notification.requestPermission().then(function (p) {
      if (p === "granted") { scheduleReminders(); render(); toast("Reminders are on"); }
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
          new Notification((isCg() ? whoName() + "’s dose: " : "Time for ") + x.med.name, { body: x.med.dosage + " — " + fmtTime(x.time) });
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
     ONBOARDING — role fork
     ============================================================ */
  var onboard = document.getElementById("onboard");
  var obPhoneNum = "";

  function showOnboarding() {
    onboard.hidden = false;
    obAuth();
  }

  /* --- step 0: phone sign-in --- */
  function obAuth() {
    onboard.innerHTML =
      '<div class="ob-art"><div class="ob-mark">℞</div></div>' +
      '<h1 class="ob-title">Every dose,<br><em>on time.</em></h1>' +
      '<p class="ob-sub">Sign in with your phone number — your schedule stays yours, on your device.</p>' +
      '<div class="field"><label>Phone number</label><input id="ob-phone" type="tel" inputmode="tel" placeholder="(555) 014-2000" value="' + esc(obPhoneNum) + '" autocomplete="tel"></div>' +
      '<button class="btn-primary" id="ob-send">Send verification code</button>';
    var input = document.getElementById("ob-phone");
    function send() {
      var v = input.value.trim();
      if (v.replace(/\D/g, "").length < 7) { toast("Enter a valid phone number"); return; }
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
    onboard.innerHTML =
      '<div class="ob-art"><div class="ob-mark">℞</div></div>' +
      '<h1 class="ob-title">Enter your<br><em>code.</em></h1>' +
      '<p class="ob-sub">We texted a 4-digit code to <b>' + esc(obPhoneNum) + '</b>.<br>Demo build — the code is <b>0000</b>.</p>' +
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
        toast("That code didn’t match — try 0000");
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
    document.getElementById("ob-resend").onclick = function () { toast("New code sent — it’s still 0000"); };
    document.getElementById("ob-back").onclick = obAuth;
    boxes[0].focus();
  }
  function obStep1() {
    onboard.innerHTML =
      '<div class="ob-art"><div class="ob-mark">℞</div></div>' +
      '<h1 class="ob-title">Every dose,<br><em>on time.</em></h1>' +
      '<p class="ob-sub">Medication schedules, supply and caregivers — one calm place. First, who are you?</p>' +
      '<div class="role-cards">' +
        '<button class="role-card" id="ob-patient">' +
          '<span class="role-ico">' + ic("user") + "</span>" +
          "<span><b>I take medications</b><span>Reminders, refills and a caregiver by your side.</span></span></button>" +
        '<button class="role-card" id="ob-cg">' +
          '<span class="role-ico">' + ic("heart") + "</span>" +
          "<span><b>I care for someone</b><span>Watch over their doses, get alerts, stay close.</span></span></button>" +
      "</div>";
    document.getElementById("ob-patient").onclick = function () { obStep2("patient"); };
    document.getElementById("ob-cg").onclick = function () { obStep2("caregiver"); };
  }
  function obStep2(role) {
    var cg = role === "caregiver";
    onboard.innerHTML =
      '<div class="ob-art"><div class="ob-mark">' + (cg ? "♡" : "℞") + "</div></div>" +
      '<h1 class="ob-title">' + (cg ? "Caring is<br><em>a team sport.</em>" : "Let’s make it<br><em>effortless.</em>") + "</h1>" +
      '<p class="ob-sub">' + (cg
        ? "You’ll see their day at a glance, get missed-dose alerts, and nudge them with one tap. A sample patient is loaded to explore."
        : "A sample cabinet is loaded so you can explore right away.") + "</p>" +
      '<div class="field"><label>Your first name</label><input id="ob-name" placeholder="e.g. ' + (cg ? "Jacob" : "Emily") + '" autocomplete="given-name"></div>' +
      (cg ? '<div class="field"><label>Who do you care for?</label><input id="ob-patient-name" placeholder="e.g. Emily" value="Emily"></div>' : "") +
      '<button class="btn-primary" id="ob-go">Begin</button>' +
      '<button class="ob-back" id="ob-back">← Back</button>';
    document.getElementById("ob-back").onclick = obStep1;
    document.getElementById("ob-go").onclick = function () {
      var name = document.getElementById("ob-name").value.trim();
      var patient = cg ? (document.getElementById("ob-patient-name").value.trim() || "Emily") : "";
      state.user = { name: name || "", role: role, patient: patient, phone: obPhoneNum };
      save(KEYS.user, state.user);
      if (cg) {
        var prevPhone = state.contact && state.contact.phone ? state.contact.phone : "555-0117";
        state.contact = { name: patient, relation: "Patient", phone: prevPhone };
      } else if (!state.contact || state.contact.relation === "Patient") {
        state.contact = { name: "Jacob Daga", relation: "Son", phone: "555-0142" };
      }
      persist();
      onboard.hidden = true; onboard.innerHTML = "";
      renderTabbar(); render();
      toast(name ? "Welcome, " + name.split(" ")[0] : "Welcome to DoseGuide");
    };
  }

  /* ---------------- live countdown tick ---------------- */
  setInterval(function () {
    if (state.view !== "home" || !modalWrap.hidden || !onboard.hidden) return;
    var nx = nextDose(), cd = document.getElementById("countdown");
    if (nx && cd) cd.textContent = countdownText(nx.time);
    else render();
  }, 30000);

  /* ---------------- boot ---------------- */
  renderTabbar();
  if (bellOn()) scheduleReminders();
  render();
  if (!state.user) showOnboarding();
})();
