"""Stamp index.html's local scripts and stylesheet with a content hash: gear.js -> gear.js?v=3f2a91c0.

GitHub Pages lets browsers keep each file for 10 minutes (Cache-Control: max-age=600). After a push, a
browser could load the new index.html with the old gear.js from its cache: on 30/09/2026 the new
"clear selections" button appeared without its handler. A changed file gets a new URL, so a page and
its scripts always match. Run after changing any of them:
    python tools/stamp.py          # rewrite index.html
    python tools/stamp.py --check  # exit 1 if a stamp is stale (a gate)
"""
import hashlib, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'index.html')
REF = re.compile(r'(<(?:script src|link rel="stylesheet" href)=")([\w.-]+\.(?:js|css))(?:\?v=\w+)?(")')


def stamped(html):
    def sub(m):
        with open(os.path.join(ROOT, m.group(2)), 'rb') as f:
            v = hashlib.sha1(f.read().replace(b'\r\n', b'\n')).hexdigest()[:8]
        return m.group(1) + m.group(2) + '?v=' + v + m.group(3)
    return REF.sub(sub, html)


if __name__ == '__main__':
    html = io.open(PAGE, encoding='utf-8', newline='').read()
    out = stamped(html)
    if '--check' in sys.argv:
        if out != html:
            sys.exit('index.html stamps are stale - run: python tools/stamp.py')
        print('index.html stamps up to date')
    else:
        io.open(PAGE, 'w', encoding='utf-8', newline='').write(out)
        print('stamped index.html')
