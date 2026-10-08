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
            'pixels': [i % 32 for i in range(320 * 240)], 'buildVersion': 'test', 'gitCommit': 'testcommit', 'scene': 52,
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
        with self.assertRaisesRegex(ValueError, 'requested simulation frame'):
            audit.compare(capture(), candidate)

    def test_intermediate_frames_match_only_the_requested_fraction(self):
        reference = capture()
        reference.update(version=2, interpolation=1 / 3, targetInterpolation=1 / 3)
        candidate = copy.deepcopy(reference)
        candidate['interpolation'] = 0.3333333432674408
        self.assertEqual(audit.compare(reference, candidate, interpolation_step=1)['status'], 'pass')
        result = audit.compare(reference, candidate, interpolation_step=2)
        self.assertEqual(result['status'], 'unmatched')
        self.assertIsNone(result['fractionWithinOneLevel'])
        candidate.update(interpolation=2 / 3, targetInterpolation=2 / 3)
        self.assertEqual(audit.compare(reference, candidate)['status'], 'unmatched')

    def test_legacy_reports_cannot_prove_an_intermediate_frame(self):
        with self.assertRaisesRegex(ValueError, 'version 2'):
            audit.compare(capture(), capture(), interpolation_step=1)
        intermediate = capture()
        intermediate.update(version=2, interpolation=1 / 3)
        with self.assertRaises(ValueError):
            audit.validate(intermediate)
        for value in (0, 0.5, True, float('nan'), float('inf')):
            intermediate.update(targetInterpolation=value, interpolation=value)
            with self.assertRaises(ValueError):
                audit.validate(intermediate)
        complete = capture()
        complete.update(version=2, targetInterpolation=1)
        self.assertEqual(audit.compare(capture(), complete, interpolation_step=3)['status'], 'pass')

    def test_intermediate_fixture_enables_desktop_interpolation_and_preserves_request(self):
        with tempfile.TemporaryDirectory() as directory:
            args = types.SimpleNamespace(label='house-third', entrance=187, scene=52, room=0, yaw=0,
                                         x=1, y=0, z=95, age=1, frame=60, seed=12345,
                                         interpolation_step=1, out=Path(directory))
            audit.fixture(args)
            import json
            config = json.loads((args.out / 'shipofharkinian.json').read_text())
            self.assertEqual(config['CVars']['gSettings']['InterpolationFPS'], 60)
            self.assertEqual(config['CVars']['gDeveloperTools']['RenderAudit']['InterpolationStep'], 1)

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
            args = types.SimpleNamespace(label='house', entrance=187, scene=52, room=0, yaw=0,
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
