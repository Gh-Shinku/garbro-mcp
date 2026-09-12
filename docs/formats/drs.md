# Digital Romance System DRS

## Reference and attribution

- GARBro reference: `ArcFormats/Ikura/ArcDRS.cs`, class `DrsOpener`
- GARBro tag: `DRS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014-2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

DRS has no fixed signature. A little-endian 16-bit value gives the directory size, which must be at
least 0x20 bytes and aligned to 0x10. Each 0x10-byte record contains a 12-byte CP932 filename and an
absolute data offset. The final record is a sentinel: its offset terminates the preceding entry and
its filename is unused.

Structural detection validates the aligned directory, the first filename byte, monotonic offsets,
and every placement. It runs at low priority because the format has no signature.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

The implementation is covered by a synthetic archive and a malformed-sentinel test. It has not
been validated against real game data, following the current migration policy.
