"""Generate Code.gs (the copy pasted into Apps Script) from Code.source.gs.

Hebrew letters stay readable. Every other non-ASCII character (shekel sign, middle dot, dashes,
arrows) becomes a \\uXXXX escape. Copy Code.gs via the clipboard or the file itself - never from
a terminal, which displays Hebrew in reversed order and copies it that way (30/09/2026: that is
how the sheet got a tab named "תומשרה"). Run after editing Code.source.gs:
    python backend/build.py          # write Code.gs
    python backend/build.py --check  # exit 1 if Code.gs is stale
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, 'Code.source.gs'), os.path.join(HERE, 'Code.gs')
BANNER = '// GENERATED from Code.source.gs by backend/build.py - edit that file, not this one.\n'


def build():
    s = io.open(SRC, encoding='utf-8').read()
    s = s.replace('—', '-').replace('→', '->')
    return BANNER + re.sub(r'[^\x00-\x7fא-ת]', lambda m: '\\u%04x' % ord(m.group(0)), s)


if __name__ == '__main__':
    text = build()
    if '--check' in sys.argv:
        current = io.open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        if current != text:
            sys.exit('Code.gs is stale - run: python backend/build.py')
        print('Code.gs up to date')
    else:
        io.open(OUT, 'w', encoding='utf-8', newline='\n').write(text)
        print('wrote Code.gs')
