# C's ware ARC2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/CsWare/ArcARC2.cs`, class `Arc2Opener`
- GARBro tag: `DAT/ARC2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2006-2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `arc2` archive stores a record count at 4 and the index offset at 8. Records are 0x20 bytes with a
0x10-byte name, the stored size, the data offset, and two 32-bit keys. GARbro keeps only the first
record of each repeated name.

Payloads whose keys are not both zero are transformed with a Fibonacci-style chain: each 32-bit word
has the sum of the two running keys subtracted, after which the pair advances by one step. Only
complete words are transformed, so a trailing remainder is left as stored.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x20-byte records | Supported |
| Duplicate name skipping | Supported |
| Fibonacci key chain reversal | Supported |
| Partial trailing word handling | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, the key chain, duplicate name handling, and index bounds
rejection.
