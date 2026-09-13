# Rune YK resource archive

## Reference and attribution

- GARBro reference: `Legacy/Rune/ArcYK.cs`, class `YkOpener`
- GARBro tag: `YK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A Rune archive starts with three zero words and stores a 32-bit key at 0x10 and a record count at
0x14. Records are twelve bytes with an id, a data offset, and the stored size; GARbro keeps them in a
dictionary keyed by id, so a repeated id keeps the last record.

The record with id 0 holds the name blob: a sequence of `id` and NUL-terminated name pairs. The blob
is rotated with the key when one is present, using a shift derived from `92 * key * i * (i + key)`.
Only records that received a name from the blob are exposed, and payloads are rotated with the same
key on extraction.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Id-keyed records | Supported |
| Encrypted name blob | Supported |
| Key-derived byte rotation | Supported |
| Named-entry filtering | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the id index, the encrypted name blob, payload decryption, the unencrypted
path, and header rejection.
