# Cadath KAR archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cadath/ArcKAR.cs`, class `KarOpener`
- GARBro tag: `KAR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`KAR` archives start with the bytes `KAR` and a NUL, followed by a 32-bit entry count at
offset 4. The index starts at 0x0c and uses 0x28-byte records with a 0x20-byte CP932 filename,
a 32-bit size at +0x20, and a 32-bit absolute offset at +0x24. The `.ns6` and `.ns5` script
variants are XOR-obfuscated with a key derived from the entry size (`size / 7` and `size / 13`).

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Size-derived XOR deobfuscation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
