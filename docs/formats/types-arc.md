# Types ARC archive

## Reference and attribution

- GARBro reference: `Legacy/Types/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/TYPES`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC` archives are detected by extension and are a flat chain of records: a 32-bit size, a
32-bit index, a 16-bit name length, and a null-terminated CP932 name immediately followed by
the payload. A zero size ends the walk. GARbro peeks at the first payload bytes to classify
`RIFF` audio and `TPGF` images; this port keeps the payload bytes untouched and leaves
classification to resource decoders.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Size-prefixed record chain | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
