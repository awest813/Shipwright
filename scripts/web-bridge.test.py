"""Compile the real quit bridge and launcher before the full game: python scripts/web-bridge.test.py."""
import re
import tempfile
from pathlib import Path

from web import ROOT, executable, run


def main():
    graph = (ROOT / 'soh/src/code/graph.c').read_text(encoding='utf-8')
    start = graph.index('EM_ASM({', graph.index('if (!WindowIsRunning())', graph.index('Graph_WebFrame')))
    end = graph.index('});', start) + 3
    with tempfile.TemporaryDirectory(prefix='shipwright-web-bridge-') as directory:
        directory = Path(directory).resolve()
        source = directory / 'bridge.c'
        source.write_text('#include <emscripten/emscripten.h>\nint main(void) {\n' +
                          graph[start:end] + '\nreturn 0;\n}\n', encoding='utf-8')
        output = directory / 'bridge.html'
        run(executable('emcc') + [str(source), '-O2', '-sALLOW_MEMORY_GROWTH=1',
                                 '-sMAXIMUM_MEMORY=4GB', '-sINITIAL_MEMORY=512MB',
                                 '-sGLOBAL_BASE=1mb', '-sEXIT_RUNTIME=0', '--shell-file',
                                 str(ROOT / 'soh/platform/web/shell.html'), '-o', str(output)])
        html = output.read_text(encoding='utf-8')
        if '\x00' in html:
            raise ValueError('Compiled launcher contains a NUL byte, which HTML replaces before script parsing.')
        scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', html, flags=re.DOTALL | re.IGNORECASE)
        inline = directory / 'inline.js'
        for script in scripts:
            if script.strip():
                inline.write_text(script, encoding='utf-8')
                run(executable('node') + ['--check', str(inline)])
        run(executable('node') + ['--check', str(output.with_suffix('.js'))])
    print('PASS: native quit bridge and compiled launcher parse successfully.')


if __name__ == '__main__':
    main()
