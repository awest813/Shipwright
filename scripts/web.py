#!/usr/bin/env python3
"""Build, package, validate and preview Shipwright's static web distribution. Python 3.10+."""
import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SDK_VERSION = '6.0.11'


def run(command, cwd=ROOT, capture=False):
    print('+ ' + ' '.join(map(str, command)), flush=True)
    return subprocess.run(list(map(str, command)), cwd=cwd, check=True,
                          text=True, capture_output=capture)


def entrypoint(directory):
    if (directory / 'index.html').is_file():
        return directory / 'index.html'
    entries = list(directory.glob('soh-*.html'))
    if len(entries) != 1:
        raise ValueError('Expected index.html or exactly one soh-<commit>.html; choose a clean build directory.')
    return entries[0]


def runtime_files(directory):
    entry = entrypoint(directory)
    html = entry.read_text(encoding='utf-8')
    scripts = re.findall(r'<script\b[^>]*\bsrc\s*=\s*[\"\']?([^\s\"\'>]+)', html, re.I)
    engines = [name for name in scripts if re.fullmatch(r'soh-[\w-]+\.js', name)]
    if len(engines) != 1 or '{{{ SCRIPT }}}' in html:
        raise ValueError('The entry page must reference exactly one compiled soh-<commit>.js engine.')
    engine = engines[0][:-3]
    files = [directory / (engine + suffix) for suffix in ('.js', '.wasm', '.data')]
    manifest = directory / 'assets/rom-versions.json'
    files.append(manifest)
    for path in files:
        if not path.is_file() or not path.stat().st_size:
            raise ValueError(f'Missing or empty runtime file: {path}')
    with files[1].open('rb') as wasm:
        if wasm.read(8) != b'\x00asm\x01\x00\x00\x00':
            raise ValueError(f'Invalid WebAssembly file: {files[1]}')
    versions = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(versions, dict) or not versions:
        raise ValueError('ROM conversion manifest is empty or invalid.')
    for version in versions.values():
        name = version.get('path') if isinstance(version, dict) else None
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', name):
            raise ValueError(f'Invalid asset version: {name}')
        bundle = directory / 'assets' / (name + '.bundle.gz')
        if not bundle.is_file():
            raise ValueError(f'Missing ROM conversion bundle: {bundle}')
        try:
            with gzip.open(bundle, 'rb') as compressed:
                if not compressed.read(1):
                    raise ValueError(f'Empty ROM conversion bundle: {bundle}')
                while compressed.read(65536):
                    pass
        except (OSError, EOFError) as error:
            raise ValueError(f'Damaged ROM conversion bundle: {bundle}') from error
        files.append(bundle)
    return entry, sorted(set(files)), engine


def check(directory):
    directory = directory.resolve()
    entry, files, engine = runtime_files(directory)
    manifest = directory / 'web-manifest.json'
    if manifest.exists():
        for item in json.loads(manifest.read_text(encoding='utf-8'))['files']:
            relative = Path(item['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid path in web-manifest.json')
            path = directory / relative
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError(f'Package is incomplete or has changed: {relative}')
    print(f'Valid web build: {engine}; {len(files)} runtime files; entry {entry.name}')
    return entry, files, engine


def package(source, output):
    source, output = source.resolve(), output.resolve()
    entry, files, engine = runtime_files(source)
    # Never recurse over arbitrary build files: player ROMs, archives, saves and
    # local config must not enter a public hosting package.
    if output == source or output in source.parents or source in output.parents:
        raise ValueError('Package output and build source must be separate directories.')
    if output.exists() and any(output.iterdir()):
        raise ValueError(f'Output is not empty: {output}. Choose a new directory to avoid mixing revisions.')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(entry, output / 'index.html')
    for path in files:
        target = output / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    for optional in (engine + '.html.symbols', 'depth-test.html', 'depth-test.js', 'depth-test.wasm',
                     'browser-timing.html', 'wasm-size-audit.json'):
        if (source / optional).is_file():
            shutil.copy2(source / optional, output / optional)
    # Keep the same preview entry point available in downloaded CI artifacts.
    shutil.copy2(Path(__file__), output / 'serve.py')
    shutil.copy2(ROOT / 'soh/platform/web/README.md', output / 'readme.md')
    entries = [{'path': p.relative_to(output).as_posix(), 'bytes': p.stat().st_size,
                'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
               for p in sorted(output.rglob('*')) if p.is_file()]
    (output / 'web-manifest.json').write_text(json.dumps({'engine': engine, 'files': entries}, indent=2) + '\n', encoding='utf-8')
    check(output)
    print(f'Ready to host: {output}\nPreview: python "{output / "serve.py"}" serve --directory "{output}"')


class WebHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.js': 'text/javascript',
                      '.json': 'application/json', '.data': 'application/octet-stream',
                      '.gz': 'application/octet-stream'}

    def end_headers(self):
        # HTML and settings must not outlive a deployment. Revisioned engine
        # filenames let a production host cache its large files independently.
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        # Asset .bundle.gz files are compressed payloads decoded by the launcher.
        # Serve their bytes directly, without an automatic Content-Encoding.
        super().end_headers()


def serve(directory, host, port):
    entry, _, _ = check(directory)
    handler = partial(WebHandler, directory=str(directory.resolve()))
    try:
        with ThreadingHTTPServer((host, port), handler) as server:
            address = '127.0.0.1' if host == '0.0.0.0' else host
            print(f'Open http://{address}:{server.server_port}/{entry.name}\nPress Ctrl+C to stop.', flush=True)
            if host not in ('127.0.0.1', 'localhost', '::1'):
                print('ROM conversion on other devices requires HTTPS; use a static HTTPS host.', flush=True)
            server.serve_forever()
    except OSError as error:
        raise ValueError(f'Could not listen on {host}:{port}: {error}. Try --port with a different number.') from error


def executable(name):
    result = shutil.which(name)
    if not result:
        raise ValueError(f'{name} was not found. Install the prerequisites and activate emsdk {SDK_VERSION} in this shell.')
    # Windows SDK entry points can be .bat; explicit cmd invocation preserves
    # paths containing spaces, without involving a shell for ordinary commands.
    return ['cmd', '/d', '/c', result] if result.lower().endswith(('.bat', '.cmd')) else [result]


def build(args):
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError(f'Output is not empty: {args.output}. Choose --output with a new directory.')
    tools = {name: executable(name) for name in ('cmake', 'emcmake', 'embuilder', 'emcc')}
    executable('ninja')
    version = run(tools['emcc'] + ['--version'], capture=True).stdout
    if not re.search(r'\b' + re.escape(SDK_VERSION) + r'\b', version):
        raise ValueError(f'Activate emsdk {SDK_VERSION}; detected: {version.splitlines()[0]}')
    for submodule in ('libultraship', 'torch'):
        if not (ROOT / submodule / 'CMakeLists.txt').exists():
            raise ValueError('Submodules are missing. Run: git submodule update --init --recursive')
    prebuilt = args.prebuilt.resolve() if args.prebuilt else None
    if prebuilt and not prebuilt.is_file():
        raise ValueError(f'Prebuilt soh.o2r was not found: {prebuilt}')
    if not prebuilt:
        native = args.native_build.resolve()
        run(tools['cmake'] + ['-S', ROOT, '-B', native, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
                             '-DSOH_TOOLS_ONLY=ON', *args.native_cmake_arg])
        run(tools['cmake'] + ['--build', native, '--config', 'Release', '--target', 'GenerateSohOtr', '-j', args.jobs])
        prebuilt = native / 'soh/soh.o2r'
    run(tools['embuilder'] + ['build', 'sdl2', 'sdl2_net', 'zlib', 'bzip2', 'ogg', 'vorbis'])
    build_dir = args.build_dir.resolve()
    run(tools['emcmake'] + tools['cmake'] + ['-S', ROOT, '-B', build_dir, '-G', 'Ninja',
          '-DCMAKE_BUILD_TYPE=Release', f'-DSOH_PREBUILT_O2R={prebuilt}', *args.cmake_arg])
    run(tools['cmake'] + ['--build', build_dir, '-j', args.jobs])
    shutil.copy2(ROOT / 'soh/platform/web/browser-timing.html', build_dir / 'soh/browser-timing.html')
    package(build_dir / 'soh', args.output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    builder = commands.add_parser('build', help='Build host tools and Wasm, then create a static hosting package')
    builder.add_argument('--prebuilt', type=Path, help='Use a matching native soh.o2r; skips native compiler/dependencies')
    builder.add_argument('--native-build', type=Path, default=ROOT / 'build-web-tools')
    builder.add_argument('--build-dir', type=Path, default=ROOT / 'build-web')
    builder.add_argument('--output', type=Path, default=ROOT / 'dist/web')
    builder.add_argument('--jobs', type=int, default=4)
    builder.add_argument('--native-cmake-arg', action='append', default=[], help='Native CMake argument; use = before -D')
    builder.add_argument('--cmake-arg', action='append', default=[], help='Web CMake argument; use = before -D')
    packer = commands.add_parser('package', help='Package an existing compiled build without player files')
    packer.add_argument('--source', type=Path, required=True)
    packer.add_argument('--output', type=Path, required=True)
    validator = commands.add_parser('check', help='Check runtime files, ROM bundles and package checksums')
    validator.add_argument('--directory', type=Path, default=Path.cwd())
    preview = commands.add_parser('serve', help='Validate and serve a downloaded or locally built web package')
    preview.add_argument('--directory', type=Path, default=Path.cwd())
    preview.add_argument('--host', default='127.0.0.1')
    preview.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    try:
        if args.command == 'build':
            if args.jobs < 1:
                raise ValueError('--jobs must be at least 1')
            build(args)
        elif args.command == 'package':
            package(args.source, args.output)
        elif args.command == 'check':
            check(args.directory)
        else:
            serve(args.directory, args.host, args.port)
    except KeyboardInterrupt:
        pass
    except (ValueError, OSError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f'Web {args.command} failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
