# CA Inter Study Hub

Static, dependency-free PWA with two tabs:

- **Library**: a link tree over the ICAI study material PDFs in `../material`, with search,
  jump-to-page topic links and a per-chapter "done" tick.
- **Plan**: a day-by-day study plan, one paper at a time in paper-number order (read every chapter in
  scope, then revise, then the next paper). It checks each paper against its exam date and says plainly
  when the plan does not fit. Chapters can be left out of scope.

Everything is stored in the browser's localStorage. Exam dates default to ICAI's notice of 23 Sep 2026
(Group I: 2, 4, 6 Jan 2027; Group II: 8, 10, 12 Jan 2027). The notice does not say which paper is on which
day, so the paper-to-date mapping in `app/plan.js` (`DEFAULT_EXAMS`) is an assumption and is editable in the app.

Run locally from the repo root (the app links to `../material/`, so serve the root, not `app/`):

    python3 -m http.server 8000      # then open http://localhost:8000/app/

Regenerate the syllabus after changing the PDFs or `material/manifest.json`:

    python3 tools/build_syllabus.py  # needs poppler-utils (pdftotext, pdfinfo)

`app/data/syllabus.json` is generated: paper > module > chapter > file, with page counts,
learning outcomes and section headings (with page numbers, used for jump-to-page links).
Section headings are parsed from the PDF text, so a few multi-line headings are truncated.

Known limits: progress and plan settings are per-device (no sync yet); PDFs are not cached for offline use;
the planner has no spaced-revision loops or test scheduling yet.
