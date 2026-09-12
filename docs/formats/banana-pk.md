# BANANA Shu-Shu PK archive

## Reference and attribution

- GARbro reference: `ArcFormats/Banana/ArcPK.cs`, class `PkOpener`
- GARbro tag: `PK/BANANA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PK` archives are detected by the `.pk` and `.dat` extensions. A 32-bit entry count sits at offset 0
and the compressed-name index begins at offset 4. Each record is:

| Field | Size | Meaning |
| --- | ---: | --- |
| length | 1 | obfuscated name length |
| name | length | obfuscated CP932 name |
| offset | 4 | big-endian absolute offset |
| size | 4 | big-endian size |

Name bytes are decoded as `byte - key` where `key` starts at `length + 1` and decreases for every
byte. GARbro rejects names with bytes outside 0x20..0xfc, and this port keeps the same guard. Entry
offsets must follow the record that contains them.

Scripts (`.scr`) are LZSS-compressed with the default GARbro variant and are decompressed on
extraction.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Obfuscated CP932 names | Supported |
| Big-endian offsets | Supported |
| Default LZSS decompression for `.scr` | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the name obfuscation, big-endian fields, packed and raw entries, and the
index boundary checks.
