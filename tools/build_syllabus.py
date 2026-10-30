"""Build app/data/syllabus.json from material/manifest.json and the PDFs.

Usage: python3 tools/build_syllabus.py
Needs poppler's pdftotext/pdfinfo on PATH.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MATERIAL = ROOT / "material"
OUT = ROOT / "app" / "data" / "syllabus.json"

PAPERS = {  # key = ICAI paper id from the manifest
    144: dict(code="P1", name="Advanced Accounting", group=1, slug="1-advanced-accounting"),
    145: dict(code="P2", name="Corporate and Other Laws", group=1, slug="2-corporate-and-other-laws"),
    137: dict(code="P3A", name="Taxation: Income-tax Law", group=1, slug="3a-taxation-income-tax"),
    136: dict(code="P3B", name="Taxation: Goods and Services Tax", group=1, slug="3b-taxation-gst"),
    146: dict(code="P4", name="Cost and Management Accounting", group=2, slug="4-cost-and-management-accounting"),
    147: dict(code="P5", name="Auditing and Ethics", group=2, slug="5-auditing-and-ethics"),
    151: dict(code="P6A", name="Financial Management", group=2, slug="6a-financial-management"),
    156: dict(code="P6B", name="Strategic Management", group=2, slug="6b-strategic-management"),
}
SECTION = re.compile(r"^\s{0,8}(\d{1,2}\.\d{1,2})\.?\s+([A-Z][^\n]{3,110})$")
TOPIC = re.compile(r"^\s{0,8}(\d{1,2})\.\s+([A-Z][A-Z0-9 ,&'’\-–/()]{4,90})$")
FOOTER = re.compile(r"(?i)\b(advanced accounting|auditing and ethics|taxation|financial management|"
                    r"strategic management|cost and management|corporate and other laws|"
                    r"income[- ]tax law|goods and services tax)\b|^\s*\d+\.\d+\s*$|©")


def fix(t):
    try:
        return t.encode("cp1252").decode("utf-8")
    except Exception:
        return t


def pages_of(path):
    out = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", out).group(1))


def page_texts(path):
    txt = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True,
                         errors="ignore").stdout
    return txt.split("\f")


def outcomes(first_pages):
    """Learning outcomes: bullet glyphs do not survive extraction, so items are detected by indent
    (a hanging indent deeper than the first item marks a continuation line)."""
    lines = "\n".join(first_pages).splitlines()
    start = next((i for i, l in enumerate(lines) if re.search(r"(?i)learning\s+(outcomes?|objectives?)", l)), None)
    if start is None:
        return []
    block = []
    for l in lines[start + 1:start + 60]:
        s = l.strip()
        if re.search(r"(?i)^(chapter\s+)?overview\b|©", s):
            break
        if s and not re.match(r"(?i)[.\s]*(after (studying|going through|reading)|at the end of)|.*you (will|would|should) be able", s):
            block.append(l)
    BUL = "♦•◆▪●\uf000-\uf8ff"
    glyph = re.compile(rf"^\s*[{BUL}]")
    use_glyph = any(glyph.match(l) for l in block)
    items, base = [], None
    for l in block:
        indent = len(l) - len(l.lstrip())
        base = indent if base is None else base
        if (use_glyph and glyph.match(l)) or (not use_glyph and indent <= base) or not items:
            items.append(re.sub(rf"^[{BUL}\-–\s]+", "", l.strip()))
        else:
            items[-1] += " " + l.strip()
    return [re.sub(r"\s+", " ", i) for i in items if len(i) > 8][:40]


def sections(pages):
    seen, out = set(), []
    for n, text in enumerate(pages, 1):
        for line in text.splitlines():
            if FOOTER.search(line):
                continue
            m, lvl = SECTION.match(line), 2
            if not m:
                m, lvl = TOPIC.match(line), 1
            if not m:
                continue
            num, title = m.group(1), re.sub(r"\s{2,}.*", "", m.group(2)).strip()
            if (lvl, num) in seen or (lvl == 2 and int(num.split(".")[1]) > 40):
                continue
            seen.add((lvl, num))
            out.append(dict(num=num, title=title, page=n, level=lvl))
    return out


def main():
    manifest = json.load(open(MATERIAL / "manifest.json"))
    papers = {pid: dict(meta, id=pid, modules={}, extras=[], edition=None) for pid, meta in PAPERS.items()}
    for x in manifest:
        p = papers[x["paper"]]
        path = MATERIAL / x["path"]
        title, unit = fix(x["title"]), x["unit"] and fix(x["unit"])
        base = dict(file=x["path"], pages=pages_of(path))
        p["edition"] = p["edition"] or x.get("cover_text_edition")
        if x["module"] is None:  # corrigenda / statutory updates
            p["extras"].append(dict(base, title=title, kind="update"))
            continue
        mod = p["modules"].setdefault(x["module"], dict(number=x["module"], front=[], chapters={}))
        part = None
        if unit and re.match(r"Chapter\s+\d+", unit, re.I):  # e.g. "Section III" > "Chapter 4: ..."
            part, title, unit = title, unit, (fix(x["sub"]) if x.get("sub") else None)
        low = title.lower()
        if not re.match(r"Chapter\s+\d+", title, re.I) and (part or unit) and not low.startswith(("initial", "appendix")) \
                and (low.startswith(("section", "answers", "part")) or "scenario" in (unit or "").lower()):
            label = f"{title}: {unit}" if unit else title
            mod.setdefault("supplements", []).append(dict(base, title=label))
            continue
        if low.startswith("initial"):
            mod["front"].append(dict(base, title="Initial pages"))
            continue
        if low.startswith("appendix"):
            mod["front"].append(dict(base, title="Appendix"))
            continue
        m = re.match(r"Chapter\s+(\d+)\s*[:\-]?\s*(.*)", title, re.I)
        num, name = (int(m.group(1)), m.group(2)) if m else (None, title)
        ch = mod["chapters"].setdefault(num or name, dict(number=num, title=name, part=part, files=[]))
        pages = page_texts(path)
        entry = dict(base, title=unit or "Full chapter", unit=unit,
                     outcomes=outcomes(pages[:2]), sections=sections(pages))
        ch["files"].append(entry)
    result = []
    for p in papers.values():
        mods = []
        for mn in sorted(p["modules"]):
            m = p["modules"][mn]
            chs = sorted(m["chapters"].values(), key=lambda c: (bool(c["part"]) and "part ii" in c["part"].lower(), c["number"] or 0))
            for c in chs:
                c["pages"] = sum(f["pages"] for f in c["files"])
            mods.append(dict(number=mn, front=m["front"], supplements=m.get("supplements", []), chapters=chs))
        p["modules"] = mods
        p["pages"] = sum(c["pages"] for m in mods for c in m["chapters"])
        result.append(p)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump(dict(exam="CA Intermediate", edition="ICAI study material, May 2026 edition", papers=result),
              open(OUT, "w"), indent=1, ensure_ascii=False)
    for p in result:
        n = sum(len(m["chapters"]) for m in p["modules"])
        s = sum(len(f["sections"]) for m in p["modules"] for c in m["chapters"] for f in c["files"])
        print(f"{p['code']:4} {p['name'][:34]:34} modules={len(p['modules'])} chapters={n:2} pages={p['pages']:5} sections={s}")


if __name__ == "__main__":
    main()
