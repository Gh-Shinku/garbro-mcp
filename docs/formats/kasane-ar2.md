# Kasane script engine resource archive

## Reference and attribution

- GARBro reference: `Legacy/Kasane/ArcAR2.cs`, class `Ar2Opener`
- GARBro tag: `AR2/IDX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `.ar2` file holds only payloads; the index lives in a sibling `.idx` file, which GARbro locates
with `Path.ChangeExtension`. The index starts with a 32-bit record count followed by variable-length
records: the stored size, a declared unpacked size, one unused word, the name length, the data
offset, and the name. Name bytes are XORed with 0x55.

Every data record repeats the layout: a 0x10-byte header whose word at +0x0c is the name length XORed
with `0x55555555`, the XORed name, and the XORed payload that starts behind them.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.idx` index | Supported |
| Variable-length records | Supported |
| XOR-decrypted names | Supported |
| Data record headers | Supported |
| XOR-decrypted payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Declared unpacked size handling | Not applicable |
| Archive creation | Unsupported |

GARbro reads the declared unpacked size but never uses it, so the port ignores it as well.

Synthetic fixtures cover the companion index, record layout, name decryption, payload decryption, and
detection without a companion file.
