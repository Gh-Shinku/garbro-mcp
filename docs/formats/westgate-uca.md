# West Gate UCA graphics archive

## Reference and attribution

- GARBro reference: `Legacy/WestGate/ArcUCA.cs`, classes `UcaOpener` and `UcaTool`
- GARbro tag: `UCA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first word of the file must be zero and the entry count follows it at 4; the index then begins at
0x10 and is read through the shared WestGate reader that the UWF audio archive also uses.

That reader works on 0x10-byte records holding a 0xC-byte name field and an offset word, where each
record's word is its own entry's data offset. The first entry's start comes from the first word, and each
entry is then bounded by the following record's word, so an entry's size is the gap to the next one and
the last entry runs to the end of the file. Names may not repeat back to back, may not be blank, and may
not contain a character the reference rejects as an invalid file name; every bound must move strictly
forward and stay inside the file.

The format carries no signature and GARbro registers it for the `uca` and `arc` extensions, so the zero
word plus that index validation are the detection. GARbro decodes the payloads as images and even treats
a leading 0x28 as its own bitmap header; that is an image concern outside the archive layer, and the
port extracts the payloads verbatim.

## Support

| Capability | Status |
| --- | --- |
| Zero first word requirement | Supported |
| Entry count validation | Supported |
| Index from 0x10 with 0x10-byte records | Supported |
| Sizes derived from the following record's word | Supported |
| Consecutive duplicate and blank name rejection | Supported |
| Invalid file name character rejection | Supported |
| Forward-moving bound validation | Supported |
| Entry listing and extraction | Supported |
| Image decoding (including the 0x28 bitmap header) | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover derived sizes, a non-zero first word, consecutive duplicate names, and a bound
that does not move forward.
