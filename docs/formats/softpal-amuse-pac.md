# Amuse Craft PAC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Softpal/ArcPAC.cs`, class `Pac2Opener`
- GARbro tag: `PAC/AMUSE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This variant announces itself with `PAC `, keeps its entry count at 8, and starts its index at 0x804. It
shares the record layout, the name field width and the payload transform of its Softpal sibling: a wide
0x20-byte name field, the stored size, and the data offset, with the first record's offset word required to
equal the end of the index.

Two differences from the sibling are mirrored rather than unified. Only the wide name field is tried here,
and the reference omits the sibling's check that the index ends inside the file. The `Pac2Opener` class
inherits `OpenEntry` unchanged, so the `$`-marked transform behind a sixteen-byte prefix applies exactly as
it does for the Softpal variant.

## Support

| Capability | Status |
| --- | --- |
| `PAC ` signature and count at 8 | Supported |
| Index at 0x804 with the wide name field only | Supported |
| First-offset alignment check | Supported |
| Entry placement validation | Supported |
| CP932 names with blank rejection | Supported |
| `$`-marked payload transform behind a sixteen-byte prefix | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a normal archive and a misaligned index.
