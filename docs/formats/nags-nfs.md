# NAGS NFS archive

## Reference and attribution

- GARBro reference: `ArcFormats/Nags/ArcNFS.cs`, class `NfsOpener`
- GARBro tag: `NFS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `NFS` archive starts with a 32-bit record count, which doubles as the XOR key for the index. The
index follows at 4 with 0x20-byte records: a 0x18-byte CP932 name, a 32-bit data offset at +0x18,
and a 32-bit size at +0x1c. Offsets are relative to the end of the index.

GARbro first XOR-decrypts the low byte of the count across the whole index, but only after checking
that the last word of the first record, XORed with that byte repeated four times, is zero. Entries
named `*.scb` are stored bitwise inverted and are inverted back on extraction.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Count-derived XOR key for the index | Supported |
| Index tail validation | Supported |
| `*.scb` payload inversion | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover index decryption, script inversion, and tail-word rejection.
