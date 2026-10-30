"use strict";

const MATERIAL_BASE = "../material/";
const STORE_KEY = "ca-inter-done-v1";

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

const pdfHref = (file, page) =>
  MATERIAL_BASE + file.split("/").map(encodeURIComponent).join("/") + (page ? `#page=${page}` : "");

// Progress lives in localStorage; the app must still work if storage is blocked.
let done = new Set();
try { done = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); } catch (_) { /* private mode etc. */ }
function saveDone() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...done])); } catch (_) { /* ignore */ }
}

const chapterId = (paper, mod, ch) => `${paper.code}|${mod.number}|${ch.part || ""}|${ch.number}`;
const chapterLabel = (ch) =>
  (ch.part ? `${ch.part.replace(/\s*[–-].*$/, "")} · ` : "") + (ch.number ? `Ch ${ch.number}: ` : "") + ch.title;

function fileLink(f, label) {
  return h("li", null,
    h("a", { class: "pdf", href: pdfHref(f.file), target: "_blank", rel: "noopener" }, label || f.title),
    h("span", { class: "meta" }, ` ${f.pages} pp`));
}

function buildChapterBody(ch) {
  const body = h("div", { class: "body" });
  const multi = ch.files.length > 1;
  const files = h("ul", { class: "files" });
  for (const f of ch.files) files.append(fileLink(f, multi ? f.title : "Open chapter"));
  body.append(files);

  for (const f of ch.files) {
    const secs = f.sections || [];
    if (secs.length) {
      const list = h("ul", { class: "topics" });
      for (const s of secs) {
        list.append(h("li", { class: `l${s.level}` },
          h("a", { href: pdfHref(f.file, s.page), target: "_blank", rel: "noopener" }, `${s.num}  ${s.title}`),
          h("span", { class: "pg" }, `p.${s.page}`)));
      }
      body.append(h("details", { class: "nested" },
        h("summary", null, `Topics${multi ? " · " + f.title : ""} (${secs.length}) — jump to page`), list));
    }
    if ((f.outcomes || []).length) {
      body.append(h("details", { class: "nested" },
        h("summary", null, `Learning outcomes${multi ? " · " + f.title : ""} (${f.outcomes.length})`),
        h("ul", { class: "outcomes" }, f.outcomes.map((o) => h("li", { text: o })))));
    }
  }
  return body;
}

function render(data) {
  const root = $("#tree");
  root.replaceChildren();
  $("#edition").textContent = `${data.exam} · ${data.edition}`;

  const chapters = []; // {el, text, pages, id}
  const bars = [];     // progress updaters
  const groups = new Map();

  for (const paper of data.papers) {
    if (!groups.has(paper.group)) {
      const g = h("details", { class: "group", open: true }, h("summary", { text: `Group ${paper.group}` }));
      groups.set(paper.group, g);
      root.append(g);
    }
    const pEl = h("details", { class: "paper" });
    const pBar = h("i");
    const pMeta = h("span", { class: "meta" });
    pEl.append(h("summary", null,
      `${paper.code} · ${paper.name} `, pMeta, h("span", { class: "bar" }, pBar)));
    const pBody = h("div", { class: "body" });
    pEl.append(pBody);
    groups.get(paper.group).append(pEl);

    const mine = [];
    for (const mod of paper.modules) {
      const mEl = h("details", { class: "module" }, h("summary", { text: `Module ${mod.number}` }));
      const mBody = h("div", { class: "body" });
      mEl.append(mBody);

      const extras = [...(mod.front || []), ...(mod.supplements || [])];
      if (extras.length) {
        mBody.append(h("div", { class: "sec", text: "Front matter & practice" }),
          h("ul", { class: "files" }, extras.map((f) => fileLink(f))));
      }
      mBody.append(h("div", { class: "sec", text: "Chapters" }));
      for (const ch of mod.chapters) {
        const id = chapterId(paper, mod, ch);
        const box = h("input", { type: "checkbox", "aria-label": `Mark ${ch.title} as done` });
        box.checked = done.has(id);
        const cEl = h("details", { class: "chapter" + (box.checked ? " done" : "") },
          h("summary", null, box, h("span", { class: "ttl" },
            h("span", { class: "name", text: chapterLabel(ch) }),
            h("br"), h("span", { class: "meta", text: `${ch.pages} pages` }))));
        box.addEventListener("click", (e) => e.stopPropagation());
        box.addEventListener("change", () => {
          box.checked ? done.add(id) : done.delete(id);
          cEl.classList.toggle("done", box.checked);
          saveDone(); updateProgress();
        });
        let built = false;
        cEl.addEventListener("toggle", () => {
          if (cEl.open && !built) { built = true; cEl.append(buildChapterBody(ch)); }
        });
        mBody.append(cEl);
        const text = [paper.code, paper.name, ch.part, ch.title,
          ...ch.files.flatMap((f) => [f.title, ...(f.sections || []).map((s) => s.title), ...(f.outcomes || [])])]
          .filter(Boolean).join(" ").toLowerCase();
        const rec = { el: cEl, mod: mEl, paper: pEl, group: groups.get(paper.group), text, pages: ch.pages, box };
        chapters.push(rec); mine.push(rec);
      }
      pBody.append(mEl);
    }

    if ((paper.extras || []).length) {
      pBody.append(h("div", { class: "sec", text: "Corrigenda & statutory updates" }),
        h("ul", { class: "files" }, paper.extras.map((f) => fileLink(f))));
    }
    bars.push(() => {
      const d = mine.filter((r) => r.box.checked).length;
      const pg = mine.reduce((a, r) => a + (r.box.checked ? r.pages : 0), 0);
      const total = mine.reduce((a, r) => a + r.pages, 0);
      pMeta.textContent = `· ${paper.modules.reduce((a, m) => a + m.chapters.length, 0)} chapters · ${total.toLocaleString()} pp · ${d} done`;
      pBar.style.width = `${total ? (100 * pg) / total : 0}%`;
    });
  }

  function updateProgress() {
    bars.forEach((f) => f());
    const total = chapters.reduce((a, r) => a + r.pages, 0);
    const pg = chapters.reduce((a, r) => a + (r.box.checked ? r.pages : 0), 0);
    const n = chapters.filter((r) => r.box.checked).length;
    $("#overall").textContent =
      `${n} of ${chapters.length} chapters done · ${total ? Math.round((100 * pg) / total) : 0}% of ${total.toLocaleString()} pages`;
  }
  updateProgress();

  // Search: hide non-matching chapters, hide empty parents, open the path to every match.
  $("#q").addEventListener("input", (e) => {
    const terms = e.target.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = new Set();
    for (const r of chapters) {
      const hit = terms.every((t) => r.text.includes(t));
      r.el.hidden = !hit;
      if (hit) { shown.add(r.mod); shown.add(r.paper); shown.add(r.group); }
    }
    const all = new Set(chapters.flatMap((r) => [r.mod, r.paper, r.group]));
    for (const el of all) {
      el.hidden = terms.length > 0 && !shown.has(el);
      if (terms.length && shown.has(el)) el.open = true;
    }
    $("#toggle").hidden = false;
    document.querySelector(".empty")?.remove();
    if (terms.length && !shown.size) root.append(h("p", { class: "empty", text: "Nothing matches that search." }));
  });

  let expanded = false;
  $("#toggle").addEventListener("click", () => {
    expanded = !expanded;
    root.querySelectorAll("details").forEach((d) => { if (!d.hidden) d.open = expanded; });
    $("#toggle").textContent = expanded ? "Collapse all" : "Expand all";
  });
}

fetch("data/syllabus.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(render)
  .catch((err) => {
    $("#tree").replaceChildren(h("p", { class: "empty", text: `Couldn't load the syllabus (${err.message}). Serve the repo root over HTTP — see app/README.md.` }));
  });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
