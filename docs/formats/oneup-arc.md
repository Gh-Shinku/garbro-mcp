# One-up ARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/OneUp/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/ONE-UP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

One-up archives start with the bytes `00 41 52 43` (NUL followed by `ARC`), a 32-bit data
offset at 4, and a 32-bit entry count at 8. The index starts at 0x0c and stores, per entry, a
32-bit name length, UTF-16LE name bytes, and a 32-bit size. Payloads are laid out sequentially
from the declared data offset. Names may contain backslash-separated directories.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| UTF-16LE filenames | Supported |
| Sequential payloads | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
