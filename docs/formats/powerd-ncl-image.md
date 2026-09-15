# Powerd NCL image

Reference: `GARbro/Legacy/Powerd/ImageNCL.cs`, class `NclFormat` (Powerd image format). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/powerd/ncl-image.ts` (`powerdNclImageDescriptor`,
`powerdNclImageFormat`, id `powerd-ncl-image`). The tag is the same word as the Uran image of another engine
uses; the two are told apart by their files, by their classes and by their local identifiers, and the Uran one
has its own document.

The reference registers the word `CELL` and no extension, so the word is what finds a picture:

| offset | field |
|---|---|
| 0 | `CELL` |
| 4 | a word that has to be `0x010100` |
| 8 | twelve bytes the reference never reads |
| 0x18 | the width |
| 0x1C | the height |
| 0x24 | a bitmap |

## The picture

The bitmap behind the header is the picture, and a second bitmap behind **that** one carries its alpha channel:
the two are laid over each other and what comes out is a thirty two bit bitmap. A picture with no second bitmap
behind it, and one whose second bitmap does not read as a bitmap at all, comes out as the first one stands, at
the depth it was stored in.

The reference turns the second bitmap into the grey the framework's `Gray8` format names and the first into
`Bgr32`, which walks an indexed picture through its colour map and widens a sixteen bit one by repeating the high
bits of its channels. The port does both, and reads the alpha out of an eight bit bitmap's own bytes, which is
the depth such a channel is stored in; a channel of another depth is refused with `UNSUPPORTED_FEATURE` rather
than converted, since the framework's conversion of a colour to grey is not something that can be followed here
exactly.

The measurements an entry reports are the ones the file's header carries, which for a well formed file are the
bitmap's.

## Failing

A file with no bitmap behind its header, and one whose alpha channel holds fewer pixels than the picture it is
laid over, are refused with `INVALID_ARCHIVE`, the second of them being the reference's own array overrun.

The tests cover the word that finds the pictures and the word that does not, the bitmap read out of the header,
an eight bit picture woven into a thirty two bit one through its colour map with the alpha written after it, the
fallback when what follows the first bitmap is not one, an alpha channel that covers too few pixels, one of a
depth that cannot be read as grey, and a header with no bitmap behind it.
