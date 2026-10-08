"""Report full-engine Wasm function sizes and enforce a browser compilation budget."""
import argparse
import hashlib
import json
from pathlib import Path


class Reader:
    def __init__(self, data):
        self.data = data
        self.offset = 0

    def take(self, count):
        end = self.offset + count
        if end > len(self.data):
            raise ValueError('truncated Wasm section')
        result = self.data[self.offset:end]
        self.offset = end
        return result

    def byte(self):
        return self.take(1)[0]

    def leb(self):
        value = 0
        for shift in range(0, 70, 7):
            byte = self.byte()
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError('oversized Wasm integer')

    def name(self):
        self.take(self.leb())

    def limits(self):
        flags = self.leb()
        self.leb()
        if flags & 1:
            self.leb()

    def value_type(self):
        if self.byte() in (0x63, 0x64):
            self.leb()  # typed reference's signed heap-type encoding has the same byte length

    def finish(self):
        if self.offset != len(self.data):
            raise ValueError('unexpected trailing section data')


def inspect(data, symbols):
    module = Reader(data)
    if module.take(8) != b'\0asm\x01\0\0\0':
        raise ValueError('requires a version 1 Wasm module')
    imports = 0
    functions = None
    bodies = None
    seen = set()
    while module.offset < len(data):
        kind = module.byte()
        section = Reader(module.take(module.leb()))
        if kind and kind in seen:
            raise ValueError('duplicate Wasm section')
        seen.add(kind)
        if kind == 2:
            for _ in range(section.leb()):
                section.name()
                section.name()
                import_kind = section.byte()
                if import_kind == 0:
                    imports += 1
                    section.leb()
                elif import_kind == 1:
                    section.value_type()
                    section.limits()
                elif import_kind == 2:
                    section.limits()
                elif import_kind == 3:
                    section.value_type()
                    section.byte()
                elif import_kind == 4:
                    section.byte()
                    section.leb()
                else:
                    raise ValueError('unsupported Wasm import kind')
            section.finish()
        elif kind == 3:
            functions = section.leb()
            for _ in range(functions):
                section.leb()
            section.finish()
        elif kind == 10:
            bodies = []
            for index in range(section.leb()):
                size = section.leb()
                body = Reader(section.take(size))
                locals_count = 0
                for _ in range(body.leb()):
                    locals_count += body.leb()
                    body.value_type()
                function_index = imports + index
                bodies.append({'functionIndex': function_index, 'name': symbols.get(function_index),
                               'bodyBytes': size, 'locals': locals_count})
            section.finish()
    if functions is None or bodies is None or functions != len(bodies):
        raise ValueError('missing or mismatched function/code sections')
    return imports, bodies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wasm', type=Path)
    parser.add_argument('--symbols', type=Path)
    parser.add_argument('--max-body-bytes', type=int, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.max_body_bytes <= 0:
        parser.error('--max-body-bytes must be positive')
    symbols = {}
    try:
        if args.symbols:
            for line in args.symbols.read_text(encoding='utf-8').splitlines():
                index, name = line.split(':', 1)
                index = int(index)
                if index in symbols:
                    raise ValueError('duplicate symbol-map function index')
                symbols[index] = name
        data = args.wasm.read_bytes()
        imports, bodies = inspect(data, symbols)
        count = imports + len(bodies)
        if args.symbols and (len(symbols) != count or any(index < 0 or index >= count for index in symbols)):
            raise ValueError('symbol map does not cover this module\'s function indexes')
    except (OSError, ValueError) as error:
        parser.exit(2, f'Wasm size audit failed: {error}\n')
    oversized = [body for body in bodies if body['bodyBytes'] > args.max_body_bytes]
    result = {'format': 'shipwright-wasm-size-audit', 'version': 1, 'wasm': args.wasm.name,
              'sha256': hashlib.sha256(data).hexdigest(), 'wasmBytes': len(data),
              'importedFunctions': imports, 'definedFunctions': len(bodies),
              'maxBodyBytes': args.max_body_bytes, 'status': 'fail' if oversized else 'pass',
              'oversizedFunctions': oversized,
              'largestBodies': sorted(bodies, key=lambda body: body['bodyBytes'], reverse=True)[:12],
              'largestLocalCounts': sorted(bodies, key=lambda body: body['locals'], reverse=True)[:12]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Wasm function-size budget: {result['status']} ({len(bodies)} functions, "
          f"{len(oversized)} above {args.max_body_bytes} bytes)")
    for body in oversized:
        print(f"  {body['functionIndex']}: {body['name'] or '<unnamed>'}: {body['bodyBytes']} bytes")
    return bool(oversized)


if __name__ == '__main__':
    raise SystemExit(main())
