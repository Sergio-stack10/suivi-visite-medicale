#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assemble le fichier final dist/worker.js :
  1. index.html + styles.css + app.js  ->  un seul HTML autonome
  2. HTML embarqué dans worker.template.js (chaîne JSON)
Usage : python3 build.py
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
PUB = os.path.join(BASE, "public")
OUT = os.path.join(ROOT, "dist")
os.makedirs(OUT, exist_ok=True)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    html = read(os.path.join(PUB, "index.html"))
    css = read(os.path.join(PUB, "styles.css"))
    js = read(os.path.join(PUB, "app.js"))

    if "</script" in js.lower():
        raise SystemExit("ERREUR : app.js contient '</script' — impossible d'inliner tel quel.")

    html = html.replace(
        '<link rel="stylesheet" href="/styles.css">',
        "<style>\n" + css + "\n</style>",
    )
    html = html.replace(
        '<script src="/app.js"></script>',
        "<script>\n" + js + "\n</script>",
    )
    if 'href="/styles.css"' in html or 'src="/app.js"' in html:
        raise SystemExit("ERREUR : remplacement incomplet (styles/app.js non inlinés).")

    # HTML autonome (debug/local) — sert aussi au test hors ligne
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # Worker final
    worker = read(os.path.join(BASE, "worker.template.js"))
    marker = "/*__INDEX_HTML__*/'<!DOCTYPE html><html><body>Build manquant : lancez build.py</body></html>'"
    if marker not in worker:
        raise SystemExit("ERREUR : marqueur introuvable dans worker.template.js")
    worker = worker.replace(marker, "/*__INDEX_HTML__*/" + json.dumps(html, ensure_ascii=False))
    with open(os.path.join(OUT, "worker.js"), "w", encoding="utf-8") as f:
        f.write(worker)

    for name in ("index.html", "worker.js"):
        p = os.path.join(OUT, name)
        print(f"OK -> {p} ({os.path.getsize(p)/1024:.0f} Ko)")


if __name__ == "__main__":
    main()
