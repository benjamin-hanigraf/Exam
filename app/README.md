# CA Inter Study Hub

Static, dependency-free PWA: a link tree over the ICAI study material PDFs in `../material`,
with search and a per-chapter "done" tick (stored in the browser's localStorage).

Run locally from the repo root (the app links to `../material/`, so serve the root, not `app/`):

    python3 -m http.server 8000      # then open http://localhost:8000/app/

Regenerate the syllabus after changing the PDFs or `material/manifest.json`:

    python3 tools/build_syllabus.py  # needs poppler-utils (pdftotext, pdfinfo)

`app/data/syllabus.json` is generated: paper > module > chapter > file, with page counts,
learning outcomes and section headings (with page numbers, used for jump-to-page links).
Section headings are parsed from the PDF text, so a few multi-line headings are truncated.

Known limits: progress is per-device (no sync yet); PDFs are not cached for offline use.
