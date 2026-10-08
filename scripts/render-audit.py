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
    if capture.get('format') != 'shipwright-render-capture' or capture.get('version') != 1:
        raise ValueError('unsupported capture format')
    if capture.get('reason') != 'captured':
        raise ValueError(f"capture failed: {capture.get('reason')}")
    if capture.get('pixelFormat') != 'rgb555-top-down' or (capture.get('width'), capture.get('height')) != (320, 240):
        raise ValueError('requires a 320 x 240 RGB555 capture')
    pixels = capture.get('pixels', [])
    if len(pixels) != 320 * 240 or any(type(p) is not int or not 0 <= p <= 32767 for p in pixels):
        raise ValueError('invalid pixel array')
    if len(set(pixels)) < 8:
        raise ValueError('blank or insufficiently varied capture')
    for key in ('label', 'buildVersion', 'gitCommit', 'scene', 'frame', 'targetFrame', 'seed', 'interpolation', 'entrance',
                'age', 'dayTime', 'health', 'player', 'camera', 'room', 'settings'):
        if key not in capture:
            raise ValueError(f'missing state metadata: {key}')
    if capture['frame'] != capture['targetFrame'] or capture['interpolation'] != 1:
        raise ValueError('capture is not the requested full simulation frame')


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


def compare(reference, candidate, threshold=0.94):
    validate(reference)
    validate(candidate)
    keys = ('label', 'buildVersion', 'gitCommit', 'scene', 'frame', 'seed', 'interpolation', 'entrance', 'age', 'dayTime',
            'health', 'player', 'camera', 'room', 'settings')
    differences = state_mismatches({k: reference[k] for k in keys}, {k: candidate[k] for k in keys})
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
            'pixels': count, 'pixelsWithinOneLevel': within, 'fractionWithinOneLevel': fraction,
            'meanAbsoluteChannelError8Bit': absolute_error * 255 / (count * 3 * 31),
            'maxChannelError8Bit': maximum_error * 255 / 31,
            'referenceBackend': reference.get('backend'), 'candidateBackend': candidate.get('backend')}


def write_png(path, pixels):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    rows = bytearray()
    for y in range(240):
        rows.append(0)
        for pixel in pixels[y * 320:(y + 1) * 320]:
            rows.extend(round(c * 255 / 31) for c in channels(pixel))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 320, 240, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def fixture(args):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.label):
        raise ValueError('invalid fixture label')
    if args.frame < 1 or not 0 <= args.seed <= 2147483647 or not 0 <= args.scene <= 255:
        raise ValueError('invalid frame, seed or scene')
    if (args.out / 'shipofharkinian.json').exists():
        raise ValueError('fixture directory already contains a config; use a new isolated directory')
    config = {
        'ConfigVersion': 7,
        'Window': {'Width': 640, 'Height': 480, 'Backend': {'Id': 2, 'Name': 'OpenGL'}, 'AudioBackend': 'sdl'},
        'CVars': {
            'gSettings': {'BootSequence': 4, 'LowResMode': 1, 'MSAAValue': 1, 'InterpolationFPS': 20,
                          'MatchRefreshRate': 0, 'AltAssets': 0, 'TextureFilter': 0},
            'gDeveloperTools': {'RenderAudit': {'Enabled': 1, 'Frame': args.frame, 'Scene': args.scene,
                                               'Seed': args.seed, 'Label': args.label, 'Age': args.age, 'Exit': 1}},
        },
        'WarpPoints': {args.label: {'entranceId': args.entrance, 'roomNum': args.room,
                                   'pos': {'x': args.x, 'y': args.y, 'z': args.z},
                                   'rotY': args.yaw, 'bootToPoint': True}},
    }
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
    create.add_argument('--out', type=Path, required=True)
    diff = commands.add_parser('compare', help='reject unmatched states, then measure every pixel')
    diff.add_argument('reference', type=Path)
    diff.add_argument('candidate', type=Path)
    diff.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'fixture':
        fixture(args)
        return
    reference = json.loads(args.reference.read_text(encoding='utf-8'))
    candidate = json.loads(args.candidate.read_text(encoding='utf-8'))
    report = compare(reference, candidate)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    write_png(args.out / 'reference.png', reference['pixels'])
    write_png(args.out / 'candidate.png', candidate['pixels'])
    if report['status'] != 'unmatched':
        error_pixels = [(31 << 10) if max(abs(a - b) for a, b in zip(channels(x), channels(y))) > 1 else 0
                        for x, y in zip(reference['pixels'], candidate['pixels'])]
        write_png(args.out / 'differences.png', error_pixels)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['status'] == 'pass' else 1)


if __name__ == '__main__':
    main()
