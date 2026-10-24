#!/usr/bin/env python3
"""Build styles/thai-readable.css: the theme in styles/src/ with Sarabun embedded.

    python3 styles/build_style.py [--install]

--install also copies the result into this machine's style folder for the patched
extension. Edit styles/src/thai-readable.theme.css, never the built file.
"""
import base64, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FACES = [("Regular", "normal", 400), ("Bold", "normal", 700),
         ("Italic", "italic", 400), ("BoldItalic", "italic", 700)]

head = ("/* Built by styles/build_style.py from styles/src/thai-readable.theme.css.\n"
        " * Sarabun is embedded (Regular, Bold, Italic, Bold Italic): no font install needed.\n"
        " * Sarabun: Copyright 2018 The Sarabun Project Authors\n"
        " * (https://github.com/cadsondemak/Sarabun), SIL Open Font License 1.1, see fonts/OFL.txt. */\n")
faces = ""
for name, style, weight in FACES:
    with open(os.path.join(ROOT, "fonts", f"Sarabun-{name}.ttf"), "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    faces += (f'@font-face {{\n\tfont-family: "Sarabun Embedded";\n\tfont-style: {style};\n'
              f'\tfont-weight: {weight};\n\tfont-display: swap;\n'
              f'\tsrc: url(data:font/ttf;base64,{b64}) format("truetype");\n}}\n')
theme = open(os.path.join(HERE, "src", "thai-readable.theme.css"), encoding="utf-8").read()
out = os.path.join(HERE, "thai-readable.css")
with open(out, "w", encoding="utf-8") as f:
    f.write(head + faces + "\n" + theme)
print(f"wrote {out} ({os.path.getsize(out):,} bytes)")

if "--install" in sys.argv:
    if os.name == "nt":
        dst = os.path.join(os.environ["APPDATA"], "Code", "User", "globalStorage",
                           "local.markdown-live-preview-editor-claude", "styles")
    else:
        dst = os.path.expanduser("~/.config/Code/User/globalStorage/"
                                 "local.markdown-live-preview-editor-claude/styles")
    os.makedirs(dst, exist_ok=True)
    shutil.copy(out, dst)
    print(f"installed -> {dst}")
