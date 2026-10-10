#!/usr/bin/env python3
"""Assemble NLO Botox into one HTML file.
   nlo-botox.html          full page for the nlo-apps repo (loads nlo-home.js, uses logo-white.png)
   artifact/nlo-botox.html  page body for the claude.ai artifact (no doctype/head/body, no nlo-home.js)"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
def rd(n): return open(os.path.join(here, n), encoding='utf-8').read()
logo = open(os.path.join(here, 'pdlogo.datauri'), encoding='utf-8').read().strip()
assert logo.startswith('data:image/png;base64,')
js = "var NLO_LOGO = '" + logo + "';\n" + '\n'.join(rd(n) for n in ['data.js', 'draw.js', 'text.js', 'app.js'])
css = rd('style.css')
body = rd('body.html')
fonts = 'https://fonts.googleapis.com/css2?family=BenchNine:wght@400;700&family=Montserrat:wght@400;500;600;700;800&family=Oswald:wght@400;500;600;700&display=swap'
room = """<style id="nlo-home-room">
/* The NLO Apps button (nlo-home.js) sits in the top-left corner: keep this app's header clear of it. */
@media screen{
html.nlo-home-on .sb-logo{padding-top:var(--nlo-home-drop)}
}
@media screen and (max-width:900px){
html.nlo-home-on .sb-logo{padding-top:10px;padding-left:var(--nlo-home-space)}
}
</style>"""
full = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#1B2F4C">
<title>NLO Botox</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{fonts}" rel="stylesheet">
<style>
{css}</style>
{room}
</head>
<body>
{body}
<script>
{js}
</script>
<script src="nlo-home.js" defer></script>
</body>
</html>
"""
art = f"""<meta charset="utf-8">
<title>NLO Botox</title>
<link rel="stylesheet" href="{fonts}">
<style>
{css}</style>
{body}
<script>
{js}
</script>
"""
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'dist')
os.makedirs(os.path.join(out, 'artifact'), exist_ok=True)
open(os.path.join(out, 'nlo-botox.html'), 'w', encoding='utf-8').write(full)
open(os.path.join(out, 'artifact', 'nlo-botox.html'), 'w', encoding='utf-8').write(art)
open(os.path.join(out, 'app.bundle.js'), 'w', encoding='utf-8').write(js)
print('built', len(full), 'bytes full,', len(art), 'bytes artifact')
