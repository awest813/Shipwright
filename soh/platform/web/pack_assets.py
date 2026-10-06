#!/usr/bin/env python3
"""Packs soh/assets/yml for the web build's in-browser ROM extraction.

Writes, into OUT_DIR:
  <version>.bundle.gz   every file under yml/<version>/, so the page fetches only the one it needs
  rom-versions.json     {sha1 of the big-endian ROM: {"path": <version>, "name": ...}} from config.yml

Bundle layout (before gzip), repeated per file, little-endian:
  u32 path length, path (UTF-8, relative to the version directory), u32 data length, data
"""

import gzip
import json
import os
import re
import struct
import sys


def parse_config(path):
    """Reads the hash -> {path, name} entries of config.yml without needing PyYAML."""
    versions = {}
    current = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            top = re.match(r"^([0-9a-f]{40}):\s*$", line)
            if top:
                current = {}
                versions[top.group(1)] = current
                continue
            field = re.match(r"^  (path|name):\s*(.+?)\s*$", line)
            if field and current is not None:
                current[field.group(1)] = field.group(2)
    return {sha: info for sha, info in versions.items() if "path" in info}


def pack_version(src_dir, out_path):
    with gzip.open(out_path, "wb", compresslevel=9) as out:
        for root, _, files in sorted(os.walk(src_dir)):
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, src_dir).replace(os.sep, "/").encode("utf-8")
                with open(full, "rb") as f:
                    data = f.read()
                out.write(struct.pack("<I", len(rel)))
                out.write(rel)
                out.write(struct.pack("<I", len(data)))
                out.write(data)


def main():
    if len(sys.argv) != 3:
        sys.exit(f"usage: {sys.argv[0]} YML_DIR OUT_DIR")
    yml_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    versions = parse_config(os.path.join(yml_dir, "config.yml"))
    for version in sorted({info["path"] for info in versions.values()}):
        pack_version(os.path.join(yml_dir, version), os.path.join(out_dir, f"{version}.bundle.gz"))

    with open(os.path.join(out_dir, "rom-versions.json"), "w", encoding="utf-8") as f:
        json.dump(versions, f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
