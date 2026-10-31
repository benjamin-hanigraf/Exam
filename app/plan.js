"use strict";
// Study planner. buildPlan() is pure (no DOM) so it can be tested in node; initPlan() draws the Plan tab.
// Papers are studied one at a time in paper-number order: read every included chapter, then revise.

const PLAN_KEY = "ca-inter-plan-v1";
const DAY_MS = 864e5;

// Dates are 'YYYY-MM-DD' strings handled in UTC so time zones never shift a day.
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const toYmd = (t) => new Date(t).toISOString().slice(0, 10);
const localToday = () => { const n = new Date(); return toYmd(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };

// ICAI notice of 23 Sep 2026: Group I = 2, 4, 6 Jan 2027; Group II = 8, 10, 12 Jan 2027.
// The notice gives dates, not which paper falls on which day, so this mapping is an assumption (editable).
const DEFAULT_EXAMS = { P1: "2027-01-02", P2: "2027-01-04", P3A: "2027-01-06", P3B: "2027-01-06",
                        P4: "2027-01-08", P5: "2027-01-10", P6A: "2027-01-12", P6B: "2027-01-12" };

function defaultConfig() {
  return { start: localToday(), hours: 5.5, pph: 12, revision: 0.3, restDay: 0, exams: { ...DEFAULT_EXAMS }, skip: [] };
}

function buildPlan(papers, cfg, isDone, chapterIdOf) {
  const examDates = new Set(Object.values(cfg.exams));
  const lastExam = Math.max(...Object.values(cfg.exams).map(parseYmd));
  const skip = new Set(cfg.skip);
  const studyDays = [];
  for (let t = Math.max(parseYmd(cfg.start), 0); t < lastExam; t += DAY_MS) {
    const s = toYmd(t);
    if (examDates.has(s) || (cfg.restDay >= 0 && new Date(t).getUTCDay() === cfg.restDay)) continue;
    studyDays.push(s);
  }

  // One block per paper, in the order given: read chapters, then revise.
  const blocks = papers.map((paper) => {
    const items = []; let pages = 0, readPages = 0;
    for (const mod of paper.modules) for (const ch of mod.chapters) {
      const id = chapterIdOf(paper, mod, ch);
      if (skip.has(id)) continue;
      pages += ch.pages;
      if (!isDone(id)) { readPages += ch.pages; items.push({ kind: "read", id, ch, hours: ch.pages / cfg.pph }); }
    }
    const reviseHours = (cfg.revision * pages) / cfg.pph;
    if (reviseHours > 0) items.push({ kind: "revise", hours: reviseHours });
    return { paper, items, pages, readPages, hours: items.reduce((a, i) => a + i.hours, 0) };
  });

  // Fill study days in order, splitting items across days.
  const days = studyDays.map((date) => ({ date, items: [], used: 0 }));
  let di = 0, overflow = 0;
  for (const b of blocks) {
    b.startDate = null; b.endDate = null; b.overflow = 0;
    for (const it of b.items) {
      let left = it.hours, first = true;
      while (left > 1e-9) {
        if (di >= days.length) { b.overflow += left; overflow += left; left = 0; break; }
        const day = days[di], room = cfg.hours - day.used, take = Math.min(room, left);
        left -= take; day.used += take;
        day.items.push({ ...it, paper: b.paper, hours: take, cont: !first, last: left <= 1e-9 });
        b.startDate = b.startDate || day.date; b.endDate = day.date; first = false;
        if (day.used >= cfg.hours - 1e-9) di++;
      }
    }
    const deadline = toYmd(parseYmd(cfg.exams[b.paper.code]) - DAY_MS);
    b.exam = cfg.exams[b.paper.code];
    b.late = b.overflow > 1e-9 || (b.endDate && b.endDate > deadline);
  }
  const need = blocks.reduce((a, b) => a + b.hours, 0);
  const have = studyDays.length * cfg.hours;
  const totalPages = blocks.reduce((a, b) => a + b.pages, 0);
  // Pages/hour you would need to read at for everything in scope (with revision) to fit.
  const pphNeeded = have > 0 ? (totalPages * (1 + cfg.revision)) / have : Infinity;
  return { days: days.filter((d) => d.items.length), studyDays: studyDays.length, blocks, need, have,
           shortfall: Math.max(0, need - have), overflow, totalPages, pphNeeded };
}

if (typeof module !== "undefined") module.exports = { buildPlan, defaultConfig, DEFAULT_EXAMS };

// ---------------------------------------------------------------- UI
function initPlan(data, ctx) {
  const root = document.getElementById("plan");
  let cfg = defaultConfig();
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(PLAN_KEY) || "{}") }; cfg.exams = { ...DEFAULT_EXAMS, ...cfg.exams }; } catch (_) { /* ignore */ }
  const openPapers = new Set(); // keep a paper's chapter list open across redraws
  const save = () => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ } };
  const fmt = (s) => new Date(parseYmd(s)).toLocaleDateString("en-GB", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
  const hrs = (x) => (Math.round(x * 10) / 10).toString();

  function draw() {
    const plan = buildPlan(data.papers, cfg, (id) => ctx.done.has(id), ctx.chapterId);
    root.replaceChildren();

    // 1. Settings
    const num = (key, label, attrs, parse = Number) => {
      const inp = h("input", { type: "number", value: cfg[key], ...attrs });
      inp.addEventListener("change", () => { const v = parse(inp.value); if (!Number.isNaN(v)) { cfg[key] = v; save(); draw(); } });
      return h("label", null, label, inp);
    };
    const rest = h("select", null, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      .map((d, i) => h("option", { value: i, selected: cfg.restDay === i }, d)).concat(h("option", { value: -1, selected: cfg.restDay === -1 }, "No rest day")));
    rest.addEventListener("change", () => { cfg.restDay = Number(rest.value); save(); draw(); });
    const start = h("input", { type: "date", value: cfg.start });
    start.addEventListener("change", () => { if (start.value) { cfg.start = start.value; save(); draw(); } });
    root.append(h("section", { class: "card" }, h("h2", { text: "Settings" }),
      h("div", { class: "form" },
        h("label", null, "Start date", start),
        num("hours", "Hours per day", { min: 1, max: 14, step: 0.5 }),
        num("pph", "Pages per hour", { min: 3, max: 60, step: 1 }),
        num("revision", "Revision (× read time)", { min: 0, max: 1.5, step: 0.05 }),
        h("label", null, "Rest day", rest)),
      h("p", { class: "meta", text: "Pages per hour is your reading-and-note-making speed on a first pass. 12 is a guess for someone new to the material; change it after your first week with real numbers." })));

    // 2. Verdict
    const ok = plan.shortfall < 0.05;
    root.append(h("section", { class: "card verdict " + (ok ? "ok" : "bad") },
      h("h2", { text: ok ? "This plan fits" : "This plan does not fit" }),
      h("p", null, `Time needed: `, h("b", { text: `${hrs(plan.need)} h` }), ` · time available before the last paper: `, h("b", { text: `${hrs(plan.have)} h` }),
        ` (${plan.studyDays} study days × ${cfg.hours} h).`),
      ok ? null : h("p", null, `Short by `, h("b", { text: `${hrs(plan.shortfall)} h` }),
        `. To fit everything in scope you would need to read at about `, h("b", { text: `${hrs(plan.pphNeeded)} pages/hour` }),
        ` (you set ${cfg.pph}). Options: drop lower-priority chapters below, raise hours, accept a lower revision ratio, or sit one group in January and the other in May 2027.`)));

    // 3. Today + next days
    const today = localToday();
    const upcoming = plan.days.filter((d) => d.date >= today).slice(0, 7);
    const agenda = h("section", { class: "card" }, h("h2", { text: "Today and next days" }));
    if (!upcoming.length) agenda.append(h("p", { class: "meta", text: "Nothing scheduled from today. Check the start date." }));
    upcoming.forEach((d, n) => {
      const day = h("div", { class: "day" }, h("div", { class: "dh" }, d.date === today ? "Today · " : "", fmt(d.date), h("span", { class: "meta", text: ` · ${hrs(d.used)} h` })));
      for (const it of d.items) {
        const row = h("div", { class: "task" });
        if (it.kind === "read") {
          const f = it.ch.files[0];
          const box = h("input", { type: "checkbox", "aria-label": "Mark chapter done", disabled: !it.last });
          box.checked = ctx.done.has(it.id);
          box.addEventListener("change", () => ctx.setDone(it.id, box.checked));
          row.append(box, h("span", { class: "tt" },
            h("a", { href: ctx.pdfHref(f.file), target: "_blank", rel: "noopener", text: `${it.paper.code} · ${chapterLabelShort(it.ch)}` }),
            h("span", { class: "meta", text: ` · read${it.cont ? " (cont.)" : ""} · ${hrs(it.hours)} h` })));
        } else {
          row.append(h("span", { class: "tt rev" }, `${it.paper.code} · Revise ${it.paper.name}`, h("span", { class: "meta", text: ` · ${hrs(it.hours)} h` })));
        }
        day.append(row);
      }
      agenda.append(day);
    });
    root.append(agenda);

    // 4. Paper timeline + scope
    const tl = h("section", { class: "card" }, h("h2", { text: "Papers, in order" }),
      h("p", { class: "meta", text: "One paper at a time: read its chapters, then revise it, then move on. Untick chapters to leave them out of scope." }));
    for (const b of plan.blocks) {
      const p = b.paper;
      const examInp = h("input", { type: "date", value: cfg.exams[p.code], "aria-label": `${p.code} exam date` });
      examInp.addEventListener("change", () => { if (examInp.value) { cfg.exams[p.code] = examInp.value; save(); draw(); } });
      const when = b.startDate ? `${fmt(b.startDate)} → ${b.overflow > 0 ? "runs past the exams" : fmt(b.endDate)}` : (b.overflow > 0 ? "no time left" : "nothing to do");
      const det = h("details", { class: "paperplan", open: openPapers.has(p.code) });
      det.addEventListener("toggle", () => (det.open ? openPapers.add(p.code) : openPapers.delete(p.code)));
      det.append(
        h("summary", null, h("span", { class: "pc", text: p.code }), ` ${p.name} `,
          h("span", { class: "badge " + (b.late ? "late" : "okb"), text: b.late ? "late" : "on time" }),
          h("br"), h("span", { class: "meta", text: `${b.pages} pp in scope · ${hrs(b.hours)} h · ${when}` })));
      det.append(h("div", { class: "body" }, h("label", { class: "meta" }, "Exam date ", examInp),
        ...p.modules.flatMap((m) => m.chapters.map((ch) => {
          const id = ctx.chapterId(p, m, ch);
          const box = h("input", { type: "checkbox" }); box.checked = !cfg.skip.includes(id);
          box.addEventListener("change", () => { cfg.skip = box.checked ? cfg.skip.filter((x) => x !== id) : [...cfg.skip, id]; save(); draw(); });
          return h("label", { class: "scope" }, box, h("span", null, chapterLabelShort(ch), h("span", { class: "meta", text: ` · ${ch.pages} pp` })));
        }))));
      tl.append(det);
    }
    root.append(tl);
  }

  const chapterLabelShort = (ch) => (ch.part ? `${ch.part.replace(/\s*[–-].*$/, "")} · ` : "") + (ch.number ? `Ch ${ch.number} ` : "") + ch.title;
  document.addEventListener("cainter:done", draw);
  draw();
}
