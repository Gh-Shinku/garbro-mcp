# CatSystem2 KIF/INT

## Reference and attribution

- GARBro reference: `ArcFormats/CatSystem/ArcINT.cs`, class `IntOpener`
- GARBro tag: `INT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with `KIF\0` and a little-endian entry count. Plain indexes use either 0x20-byte
or 0x40-byte CP932 filename fields followed by absolute offsets and sizes. GARbro probes the shorter
layout first and falls back to the longer layout when its names or placements are invalid.

An index whose first filename is `__key__.dat` is encrypted. It derives a Blowfish key from a stored
Mersenne Twister seed and requires a separate game-specific main key for names and placements.
Encrypted archives are detected explicitly but are not opened without that external key.

## Support

| Capability | Status |
| --- | --- |
| Signature and entry-count detection | Supported |
| 0x20 and 0x40 CP932 filename layouts | Supported |
| Plain entry listing and extraction | Supported |
| Encrypted-variant identification | Supported |
| Game-specific encrypted indexes and entries | Unsupported |
| Archive creation | Unsupported |

The plain implementation is covered by synthetic fixtures for both filename layouts. An encrypted
header fixture verifies the explicit unsupported path. No real game data is used, following the
current migration policy.
