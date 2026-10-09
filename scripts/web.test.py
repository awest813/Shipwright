"""Packaging failures and actual HTTP behavior. Run: python scripts/web.test.py"""
import importlib.util
import gzip
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

spec = importlib.util.spec_from_file_location('web', Path(__file__).with_name('web.py'))
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


class WebDistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'compiled'
        self.source.mkdir()
        (self.source / 'assets').mkdir()
        (self.source / 'soh-abc1234.html').write_text('<script async src=soh-abc1234.js></script>')
        for suffix in ('.js', '.wasm', '.data'):
            (self.source / ('soh-abc1234' + suffix)).write_bytes(b'fixture runtime')
        (self.source / 'soh-abc1234.wasm').write_bytes(b'\x00asm\x01\x00\x00\x00')
        (self.source / 'assets/rom-versions.json').write_text(json.dumps({'hash': {'path': 'ntsc_1-2'}}))
        self.bundle = gzip.compress(b'fixture descriptions')
        (self.source / 'assets/ntsc_1-2.bundle.gz').write_bytes(self.bundle)
        self.output = self.root / 'host'

    def tearDown(self):
        self.temp.cleanup()

    def test_package_excludes_player_files_and_validates_the_matched_revision(self):
        for name in ('oot.o2r', 'rom.z64', 'shipwright-backup.json', 'shipofharkinian.json', 'soh-old.wasm'):
            (self.source / name).write_bytes(b'private or stale')
        web.package(self.source, self.output)
        for name in ('oot.o2r', 'rom.z64', 'shipwright-backup.json', 'shipofharkinian.json', 'soh-old.wasm'):
            self.assertFalse((self.output / name).exists())
        self.assertIn('soh-abc1234.js', (self.output / 'index.html').read_text())
        web.check(self.output)
        (self.output / 'soh-abc1234.wasm').write_bytes(b'\x00asm\x01\x00\x00\x00changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            web.check(self.output)

    def test_missing_engine_or_rom_bundle_prevents_packaging(self):
        (self.source / 'soh-abc1234.wasm').unlink()
        with self.assertRaisesRegex(ValueError, 'runtime file'):
            web.package(self.source, self.output)
        self.assertFalse(self.output.exists())
        (self.source / 'soh-abc1234.wasm').write_bytes(b'\x00asm\x01\x00\x00\x00')
        (self.source / 'assets/ntsc_1-2.bundle.gz').unlink()
        with self.assertRaisesRegex(ValueError, 'conversion bundle'):
            web.package(self.source, self.output)

    def test_nul_in_compiled_html_prevents_packaging(self):
        entry = self.source / 'soh-abc1234.html'
        entry.write_text(entry.read_text() + '<script>/[\x00-\\x1F]/</script>')
        with self.assertRaisesRegex(ValueError, 'NUL byte'):
            web.package(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_packaging_refuses_mixed_revisions_and_overwriting_existing_output(self):
        web.package(self.source, self.output)
        with self.assertRaisesRegex(ValueError, 'not empty'):
            web.package(self.source, self.output)
        (self.source / 'soh-other.html').write_text('old build')
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            web.runtime_files(self.source)
        with self.assertRaisesRegex(ValueError, 'separate directories'):
            web.package(self.output, self.root)

    def test_damaged_conversion_bundle_is_rejected_before_creating_the_package(self):
        (self.source / 'assets/ntsc_1-2.bundle.gz').write_bytes(self.bundle[:-6])
        with self.assertRaisesRegex(ValueError, 'Damaged ROM conversion bundle'):
            web.package(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_windows_sdk_wrappers_use_python_without_a_shell(self):
        sdk = self.root / 'SDK & tools'
        sdk.mkdir()
        wrapper = sdk / 'emcmake.bat'
        wrapper.write_text('unused wrapper')
        script = sdk / 'emcmake.py'
        script.write_text('print("fixture")')
        with patch.object(web.shutil, 'which', return_value=str(wrapper)):
            self.assertEqual(web.executable('emcmake'), [web.sys.executable, str(script)])

    def test_http_serves_wasm_mime_and_raw_bundles_under_a_subdirectory(self):
        web.package(self.source, self.output)
        with ThreadingHTTPServer(('127.0.0.1', 0), partial(web.WebHandler, directory=str(self.root))) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            base = f'http://127.0.0.1:{server.server_port}/host'
            try:
                with urlopen(base + '/soh-abc1234.wasm') as response:
                    self.assertEqual(response.headers['Content-Type'], 'application/wasm')
                    self.assertEqual(response.headers['Cache-Control'], 'no-cache')
                with urlopen(base + '/assets/ntsc_1-2.bundle.gz') as response:
                    self.assertIsNone(response.headers['Content-Encoding'])
                    self.assertEqual(response.read(), self.bundle)
                with urlopen(base + '/index.html') as response:
                    self.assertIn(b'soh-abc1234.js', response.read())
            finally:
                server.shutdown()
                worker.join()


if __name__ == '__main__':
    unittest.main()
