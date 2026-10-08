import copy
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location('render_audit', Path(__file__).with_name('render-audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def capture():
    return {'format': 'shipwright-render-capture', 'version': 1, 'reason': 'captured', 'label': 'house',
            'pixelFormat': 'rgb555-top-down', 'width': 320, 'height': 240,
            'pixels': [i % 32 for i in range(320 * 240)], 'buildVersion': 'test', 'gitCommit': 'testcommit', 'scene': 55,
            'frame': 60, 'targetFrame': 60, 'seed': 12345, 'interpolation': 1, 'entrance': 187,
            'age': 1, 'dayTime': 32768, 'health': 48, 'room': 0,
            'player': {'position': [0, 0, 0], 'yaw': 0, 'animationFrame': 3},
            'camera': {'eye': [0, 50, 80], 'at': [0, 30, 0], 'fov': 60},
            'settings': {'textureFilter': 0, 'alternateAssets': 0}, 'backend': 'OpenGL'}


class RenderAuditTests(unittest.TestCase):
    def test_identical_full_capture_passes(self):
        result = audit.compare(capture(), capture())
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(result['pixels'], 76800)
        self.assertEqual(result['fractionWithinOneLevel'], 1)
        self.assertEqual(result['meanAbsoluteChannelError8Bit'], 0)

    def test_color_quantization_tolerance_is_one_level_in_each_channel(self):
        reference = capture()
        candidate = copy.deepcopy(reference)
        candidate['pixels'] = [p + 1024 + 32 for p in reference['pixels']]
        self.assertEqual(audit.compare(reference, candidate)['status'], 'pass')
        candidate['pixels'] = [p + 2048 for p in reference['pixels']]
        self.assertEqual(audit.compare(reference, candidate)['status'], 'fail')

    def test_threshold_counts_every_pixel(self):
        reference = capture()
        candidate = copy.deepcopy(reference)
        candidate['pixels'][:4608] = [32767] * 4608
        self.assertEqual(audit.compare(reference, candidate)['fractionWithinOneLevel'], 0.94)
        self.assertEqual(audit.compare(reference, candidate)['status'], 'pass')
        candidate['pixels'][4608] = 32767
        self.assertEqual(audit.compare(reference, candidate)['status'], 'fail')

    def test_unmatched_camera_or_frame_is_not_scored(self):
        candidate = capture()
        candidate['camera']['eye'][0] = 1
        result = audit.compare(capture(), candidate)
        self.assertEqual(result['status'], 'unmatched')
        self.assertIsNone(result['fractionWithinOneLevel'])
        self.assertIn('camera.eye.0', result['stateMismatches'])
        candidate = capture()
        candidate['frame'] = 61
        with self.assertRaisesRegex(ValueError, 'requested full simulation frame'):
            audit.compare(capture(), candidate)

    def test_failed_blank_and_malformed_captures_are_rejected(self):
        for mutation in ({'reason': 'missed target simulation frame'}, {'pixels': [0] * 76800},
                         {'pixels': [False] * 76800}, {'pixels': [-1] * 76800}, {'pixels': []}):
            invalid = capture()
            invalid.update(mutation)
            with self.assertRaises(ValueError):
                audit.compare(capture(), invalid)

    def test_fixture_writes_matching_config_and_web_backup_and_png_is_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            args = types.SimpleNamespace(label='house', entrance=187, scene=55, room=0, yaw=0,
                                         x=0, y=0, z=0, age=1, frame=60, seed=12345, out=out)
            audit.fixture(args)
            import json
            import base64
            backup = json.loads((out / 'web-backup.json').read_text())
            self.assertEqual(base64.b64decode(backup['files'][0]['data']), (out / 'shipofharkinian.json').read_bytes())
            audit.write_png(out / 'capture.png', capture()['pixels'])
            self.assertEqual((out / 'capture.png').read_bytes()[:8], b'\x89PNG\r\n\x1a\n')


if __name__ == '__main__':
    unittest.main()
