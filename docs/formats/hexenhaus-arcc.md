# Hexenhaus ARCC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Hexenhaus/ArcARCC.cs`, class `ArcOpener`
- GARBro tag: `ARCC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ARCC` archive stores a record count at 0x14 and then a chain of chunks. The `NAME` chunk at 0x2a
holds a 64-bit address that points at the `ADDR` chunk, `NIDX` holds one name offset per record,
`EIDX` is skipped by the reader, and `CINF` holds the names in `12 + name length` byte records whose
bytes are XORed with 0x69.

The `ADDR` chunk stores one 64-bit offset per record. Only payloads starting with `FILE` are kept:
their stored size lives at +0x18 and the data starts behind the 0x22-byte header. Records without that
marker or with a zero size are dropped, and an archive that keeps nothing is rejected.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| `NAME`/`NIDX`/`EIDX`/`CINF`/`ADDR` chunk walk | Supported |
| 0x69 name unmasking | Supported |
| `FILE` record marker | Supported |
| Zero-size record filtering | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the chunk chain, name decoding, zero-size filtering, and chunk marker
rejection.
