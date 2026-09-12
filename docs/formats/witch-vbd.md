# Witch SOUNDDATE audio archive

## Reference and attribution

- GARBro reference: `Legacy/Witch/ArcVBD.cs`, class `SoundDataOpener`
- GARBro tag: `VBD/SOUND`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SOUNDDATE ` archives start with the ASCII signature `SOUNDDATE ` and a 32-bit entry count at
0x0a. The index starts at 0x0e and each record is a 32-bit offset, a 32-bit name length, and
the name bytes. Entry sizes are the differences between adjacent offsets in index order, with
the last entry running to the end of file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Interleaved offset/name records | Supported |
| Adjacent-size derivation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
