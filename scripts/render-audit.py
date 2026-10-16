"""Create isolated render fixtures and compare engine RGB555 captures. No dependencies."""
import argparse
import base64
import json
import math
from pathlib import Path
import re
import struct
import zlib


def validate(capture):
    if capture.get('format') != 'shipwright-render-capture' or capture.get('version') not in (1, 2, 3):
        raise ValueError('unsupported capture format')
    if capture.get('reason') != 'captured':
        raise ValueError(f"capture failed: {capture.get('reason')}")
    width, height = capture.get('width'), capture.get('height')
    validate_dimensions(width, height)
    if capture.get('pixelFormat') != 'rgb555-top-down':
        raise ValueError('requires a top-down RGB555 capture')
    if capture['version'] < 3 and (width, height) != (320, 240):
        raise ValueError('legacy captures require 320 x 240')
    if capture['version'] == 3 and (capture.get('targetWidth'), capture.get('targetHeight')) != (width, height):
        raise ValueError('capture is not the requested resolution')
    pixels = capture.get('pixels', [])
    if len(pixels) != width * height or any(type(p) is not int or not 0 <= p <= 32767 for p in pixels):
        raise ValueError('invalid pixel array')
    if len(set(pixels)) < 8:
        raise ValueError('blank or insufficiently varied capture')
    for key in ('label', 'buildVersion', 'gitCommit', 'scene', 'frame', 'targetFrame', 'seed', 'interpolation', 'entrance',
                'age', 'dayTime', 'health', 'player', 'camera', 'room', 'settings'):
        if key not in capture:
            raise ValueError(f'missing state metadata: {key}')
    target_interpolation = capture.get('targetInterpolation') if capture['version'] >= 2 else 1
    interpolation = capture['interpolation']
    if (type(target_interpolation) not in (int, float) or not math.isfinite(target_interpolation) or
            not any(abs(target_interpolation - step / 3) <= 0.000001 for step in (1, 2, 3)) or
            type(interpolation) not in (int, float) or not math.isfinite(interpolation) or
            abs(interpolation - target_interpolation) > 0.000001 or capture['frame'] != capture['targetFrame']):
        raise ValueError('capture is not the requested simulation frame and interpolation')


def validate_dimensions(width, height):
    if type(width) is not int or type(height) is not int or not 320 <= width <= 1920 or not 240 <= height <= 1080:
        raise ValueError('capture dimensions must be within 320 x 240 and 1920 x 1080')


def state_mismatches(left, right, path=''):
    if isinstance(left, dict) and isinstance(right, dict):
        differences = []
        for key in sorted(left.keys() | right.keys()):
            if key not in left or key not in right:
                differences.append(path + key)
            else:
                differences.extend(state_mismatches(left[key], right[key], path + key + '.'))
        return differences
    if isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
        return [name for i, (a, b) in enumerate(zip(left, right)) for name in state_mismatches(a, b, f'{path}{i}.')]
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        equal = math.isfinite(left) and math.isfinite(right) and abs(left - right) <= 0.001
    else:
        equal = left == right
    return [] if equal else [path.rstrip('.')]


def channels(pixel):
    return pixel >> 10, (pixel >> 5) & 31, pixel & 31


def compare(reference, candidate, threshold=0.94, interpolation_step=None):
    validate(reference)
    validate(candidate)
    if interpolation_step is not None and interpolation_step not in (1, 2, 3):
        raise ValueError('interpolation step must be 1, 2 or 3')
    if interpolation_step in (1, 2) and any(capture['version'] < 2 for capture in (reference, candidate)):
        raise ValueError('intermediate frames require version 2 or 3 captures')
    keys = ('label', 'buildVersion', 'gitCommit', 'scene', 'frame', 'seed', 'interpolation', 'entrance', 'age', 'dayTime',
            'health', 'player', 'camera', 'room', 'settings', 'width', 'height')
    reference_state = {k: reference[k] for k in keys}
    candidate_state = {k: candidate[k] for k in keys}
    reference_state['targetInterpolation'] = reference.get('targetInterpolation', 1)
    candidate_state['targetInterpolation'] = candidate.get('targetInterpolation', 1)
    differences = state_mismatches(reference_state, candidate_state)
    if interpolation_step is not None:
        for name, state in (('reference', reference_state), ('candidate', candidate_state)):
            if abs(state['targetInterpolation'] - interpolation_step / 3) > 0.000001:
                differences.append(name + '.targetInterpolation')
    if differences:
        return {'status': 'unmatched', 'stateMismatches': differences, 'fractionWithinOneLevel': None}
    within = 0
    absolute_error = 0
    maximum_error = 0
    for a, b in zip(reference['pixels'], candidate['pixels']):
        errors = [abs(x - y) for x, y in zip(channels(a), channels(b))]
        maximum_error = max(maximum_error, *errors)
        absolute_error += sum(errors)
        within += max(errors) <= 1
    count = len(reference['pixels'])
    fraction = within / count
    return {'status': 'pass' if fraction >= threshold else 'fail', 'threshold': threshold,
            'width': reference['width'], 'height': reference['height'],
            'pixels': count, 'pixelsWithinOneLevel': within, 'fractionWithinOneLevel': fraction,
            'meanAbsoluteChannelError8Bit': absolute_error * 255 / (count * 3 * 31),
            'maxChannelError8Bit': maximum_error * 255 / 31,
            'referenceBackend': reference.get('backend'), 'candidateBackend': candidate.get('backend')}


def write_png(path, pixels, width=320, height=240):
    validate_dimensions(width, height)
    if len(pixels) != width * height:
        raise ValueError('invalid PNG pixel count')
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for pixel in pixels[y * width:(y + 1) * width]:
            rows.extend(round(c * 255 / 31) for c in channels(pixel))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def fixture(args):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.label):
        raise ValueError('invalid fixture label')
    if args.frame < 1 or not 0 <= args.seed <= 2147483647 or not 0 <= args.scene <= 255:
        raise ValueError('invalid frame, seed or scene')
    interpolation_step = getattr(args, 'interpolation_step', 3)
    width, height = getattr(args, 'width', 320), getattr(args, 'height', 240)
    validate_dimensions(width, height)
    if type(interpolation_step) is not int or interpolation_step not in (1, 2, 3):
        raise ValueError('interpolation step must be 1, 2 or 3')
    if (args.out / 'shipofharkinian.json').exists():
        raise ValueError('fixture directory already contains a config; use a new isolated directory')
    config = {
        'ConfigVersion': 7,
        'Window': {'Width': max(640, width + 160), 'Height': max(480, height + 120),
                   'Backend': {'Id': 2, 'Name': 'OpenGL'}, 'AudioBackend': 'sdl'},
        'CVars': {
            'gSettings': {'BootSequence': 4, 'LowResMode': int((width, height) == (320, 240)), 'MSAAValue': 1,
                          'InterpolationFPS': 60 if interpolation_step < 3 else 20,
                          'MatchRefreshRate': 0, 'AltAssets': 0, 'TextureFilter': 0},
            'gDeveloperTools': {'RenderAudit': {'Enabled': 1, 'Frame': args.frame, 'Scene': args.scene,
                                               'Seed': args.seed, 'Label': args.label, 'Age': args.age, 'Exit': 1,
                                               'InterpolationStep': interpolation_step, 'Width': width, 'Height': height}},
        },
        'WarpPoints': {args.label: {'entranceId': args.entrance, 'roomNum': args.room,
                                   'pos': {'x': args.x, 'y': args.y, 'z': args.z},
                                   'rotY': args.yaw, 'bootToPoint': True}},
    }
    # Pixel fixtures are unattended, zero-input runs. Prevent background keyboard or
    # connected gamepad activity from installing default bindings and moving the player.
    config['CVars']['gSettings']['Controllers'] = {
        f'Port{port}': {'HasConfig': 1} for port in range(1, 5)
    }
    if (width, height) != (320, 240):
        config['CVars']['gSettings']['AdvancedResolution'] = {
            'Enabled': 1, 'VerticalResolutionToggle': 1, 'VerticalPixelCount': height,
            'AspectRatioX': float(width), 'AspectRatioY': float(height),
        }
    if getattr(args, 'continuous_presentation', False):
        config['CVars']['gDeveloperTools']['RenderAudit']['ContinuousPresentation'] = 1
    args.out.mkdir(parents=True, exist_ok=True)
    config_bytes = json.dumps(config, indent=2).encode()
    (args.out / 'shipofharkinian.json').write_bytes(config_bytes)
    backup = {'format': 'shipwright-web-backup', 'version': 1,
              'files': [{'path': 'shipofharkinian.json', 'data': base64.b64encode(config_bytes).decode()}]}
    (args.out / 'web-backup.json').write_text(json.dumps(backup), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('fixture', help='write a temporary debug-warp config and browser backup')
    create.add_argument('--label', required=True)
    for name in ('entrance', 'scene', 'room', 'yaw'):
        create.add_argument('--' + name, type=lambda value: int(value, 0), required=name in ('entrance', 'scene'), default=0)
    for name in ('x', 'y', 'z'):
        create.add_argument('--' + name, type=float, required=True)
    create.add_argument('--age', choices=(0, 1), type=int, default=1, help='0 adult, 1 child')
    create.add_argument('--frame', type=int, default=60)
    create.add_argument('--seed', type=int, default=12345)
    create.add_argument('--width', type=int, default=320, help='expected game framebuffer width')
    create.add_argument('--height', type=int, default=240, help='expected game framebuffer height')
    create.add_argument('--continuous-presentation', action='store_true',
                        help='audit control: retain the former web wall-clock interpolation before the target frame')
    create.add_argument('--interpolation-step', type=int, choices=(1, 2, 3), default=3,
                        help='one-third, two-thirds or the complete frame at 60 FPS (default: complete)')
    create.add_argument('--out', type=Path, required=True)
    diff = commands.add_parser('compare', help='reject unmatched states, then measure every pixel')
    diff.add_argument('reference', type=Path)
    diff.add_argument('candidate', type=Path)
    diff.add_argument('--out', type=Path, required=True)
    diff.add_argument('--interpolation-step', type=int, choices=(1, 2, 3),
                      help='require this interpolation fraction in both captures')
    args = parser.parse_args()
    if args.command == 'fixture':
        fixture(args)
        return
    reference = json.loads(args.reference.read_text(encoding='utf-8'))
    candidate = json.loads(args.candidate.read_text(encoding='utf-8'))
    report = compare(reference, candidate, interpolation_step=args.interpolation_step)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    write_png(args.out / 'reference.png', reference['pixels'], reference['width'], reference['height'])
    write_png(args.out / 'candidate.png', candidate['pixels'], candidate['width'], candidate['height'])
    if report['status'] != 'unmatched':
        error_pixels = [(31 << 10) if max(abs(a - b) for a, b in zip(channels(x), channels(y))) > 1 else 0
                        for x, y in zip(reference['pixels'], candidate['pixels'])]
        write_png(args.out / 'differences.png', error_pixels, reference['width'], reference['height'])
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['status'] == 'pass' else 1)


if __name__ == '__main__':
    main()
