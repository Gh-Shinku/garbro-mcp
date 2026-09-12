# Sceplay PAK archive

## Reference and attribution

- GARBro reference: `Legacy/Sceplay/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/SCEPLAY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`pak` archives start with the ASCII signature `pak` and a NUL byte followed by a 32-bit entry
count. The index at offset 8 is split into three sections: one null-terminated CP932 name per
entry, then one 32-bit size per entry, then one 32-bit offset per entry. Entries whose offset
is `0xffffffff` are absent and are dropped from the listing.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Sectioned names/sizes/offsets | Supported |
| Absent-entry skipping | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
