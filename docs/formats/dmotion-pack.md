# D-Motion resource archive

## Reference and attribution

- GARBro reference: `Legacy/DMotion/ArcDM.cs`, class `PakOpener`
- GARBro tag: `256/DMOTION`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the ASCII signature `PACK`, followed by the engine marker `FILE100DATA` at
4 and the path marker `.\\\` at 0x10. A 16-bit per-extension directory count sits at 0x16 and the
directory table offset at 0x18.

Each 0x10-byte directory record holds a 4-byte extension, a 16-bit entry count at +6, the record
table offset at +8, and the table size at +12. Directory records are 0x10 bytes with an 8-byte file
stem, a 32-bit data offset at +8, and a 32-bit size at +12; the entry name is the trimmed stem
followed by the directory extension.

## Support

| Capability | Status |
| --- | --- |
| Header and marker detection | Supported |
| Per-extension directories | Supported |
| Stem and extension name composition | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover multiple extension directories, stem trimming, marker rejection, and
payload extraction.
