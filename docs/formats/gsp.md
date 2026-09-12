# Black Rainbow GSP

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcGSP.cs`, class `GspOpener`
- GARBro tag: `GSP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

GSP has no fixed signature. It starts with a little-endian entry count followed by 0x40-byte index
records. Each record stores an absolute offset, size, and 0x38-byte CP932 filename. Entry data must
begin at or after the end of the complete index.

Structural detection validates the count, complete index, nonblank names, and every entry placement.
It runs at low priority because the format has no signature.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

The implementation is covered by a synthetic archive and a malformed-placement test. It has not
been validated against real game data, following the current migration policy.
