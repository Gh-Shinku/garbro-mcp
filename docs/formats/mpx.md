# IKURA GDL MPX

## Reference and attribution

- GARBro reference: `ArcFormats/Ikura/ArcDRS.cs`, class `MpxOpener`
- GARBro tag: `IKURA/GDL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014-2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with `SM2MPX10`, a little-endian entry count, and a declared index size. Its
0x14-byte records contain a 12-byte CP932 filename, absolute offset, and size. GARbro normalizes all
entry names to lowercase.

ISF and SNR scripts can apply one of three byte transformations from offset 8: rotate right by two
bits, bitwise inversion, or XOR with the byte at offset 6. A script ending in `SECRETFILTER100a`
requires a game-specific external secret table. Without a selected secret, GARbro returns that
entry unchanged; this implementation preserves the same lossless fallback and marks the entry as
requiring a secret.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| Lowercased CP932 filenames | Supported |
| Raw entry extraction | Supported |
| Rotate, invert, and XOR script transforms | Supported |
| Secret-filtered raw fallback | Supported |
| Secret-table decoding | Unsupported |
| Archive creation | Unsupported |

The implementation is covered by synthetic fixtures for every supported transform, the secret
fallback, and malformed placements. It has not been validated against real game data, following
the current migration policy.
