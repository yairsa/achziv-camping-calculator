"""Generate Code.gs (pure ASCII) from Code.source.gs.

Lines of the form `//@include search.js` are replaced by that file from the repo root, so code the
site and the backend share lives once.

Pasting Hebrew into the Apps Script editor reversed it, so the pasted copy writes every
non-ASCII character as a \\uXXXX escape. Run after editing Code.source.gs:
    python backend/build.py          # write Code.gs
    python backend/build.py --check  # exit 1 if Code.gs is stale
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, 'Code.source.gs'), os.path.join(HERE, 'Code.gs')
ROOT = os.path.dirname(HERE)
INCLUDE = re.compile(r'^//@include (\S+)$', re.M)   # a site file inlined here, e.g. search.js
BANNER = '// GENERATED from Code.source.gs by backend/build.py - edit that file, not this one.\n'


def build():
    s = io.open(SRC, encoding='utf-8').read()
    s = INCLUDE.sub(lambda m: io.open(os.path.join(ROOT, m.group(1)), encoding='utf-8').read().rstrip('\n'), s)
    s = s.replace('—', '-').replace('→', '->')
    return BANNER + re.sub(r'[^\x00-\x7f]', lambda m: '\\u%04x' % ord(m.group(0)), s)


if __name__ == '__main__':
    text = build()
    if '--check' in sys.argv:
        current = io.open(OUT, encoding='ascii').read() if os.path.exists(OUT) else ''
        if current != text:
            sys.exit('Code.gs is stale - run: python backend/build.py')
        print('Code.gs up to date')
    else:
        io.open(OUT, 'w', encoding='ascii', newline='\n').write(text)
        print('wrote Code.gs')
