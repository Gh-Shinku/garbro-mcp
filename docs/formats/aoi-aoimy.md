# Aoi AOIMY script archive

## Reference and attribution

- GARBro reference: `ArcFormats/Aoi/ArcBOX.cs`, class `AoiMyOpener`
- GARbro tag: `AOIMY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `AOIM` with the tag `Y01` behind it, and both the entry count and every record field are
big-endian. Records keep the 0x18-byte stride and the field positions of the named layout in the older family
member, so only the byte order and the tag differ.

Payloads are not keyed by a single byte here. Each byte is exclusive-ored with a key derived from its *absolute*
offset in the file: the reference folds the offset minus a constant into itself over five rounds, with shift and
rotation amounts taken from successive nibbles of that offset, and finally shifts the top of the last round
right by the offset's low nibble to take one byte. The port reproduces that function exactly, using logical
shifts so the unsigned arithmetic matches, and exports it along with the key-stream helper its fixtures use.

## Support

| Capability | Status |
| --- | --- |
| `AOIM` signature with the `Y01` tag | Supported |
| Big-endian count and record fields | Supported |
| Offset-derived byte key function | Supported |
| Entry placement validation | Supported |
| Keyed payload decryption | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover an entry with an offset-keyed payload and a foreign tag.
