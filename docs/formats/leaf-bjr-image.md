# Leaf obfuscated bitmap

Reference: `GARbro/ArcFormats/Leaf/ImageBJR.cs`, classes `BjrFormat` and `BjrMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/leaf/bjr-image.ts` (`leafBjrImageDescriptor`, `leafBjrImageFormat`,
id `leaf-bjr-image`, `readBjrLayout`).

The file is a bitmap with its picture **turned by a key** rather than compressed, and the reference reads it
only from a name of its own, `.bjr`. The header is the header of a bitmap, and the width, the height, the
depth and where the picture starts are read from it. A positive height means the stored rows are already the
way up a bitmap keeps them; a negative one means they are the other way, and the bitmap written out carries
the same sign the header does.

The key is made of the **letters of the file's own name**, taken as its own bytes — so a name outside ascii
turns the picture differently, which is what the reference does — and the turning is a plain arithmetic one:
every byte of an even column has the key subtracted from it and every byte of an odd column has the other key
added to it, both counting in bytes. On top of that the **rows are shuffled**: each row of the output comes
from the row the growing line key names, so the picture has to be put back together row by row.

A picture of twenty four bits is written as a bitmap of twenty four bits and one of thirty two as a bitmap of
thirty two; any other depth is handed the ramp of greys, which is what the reference falls back to where it
would have read a colour map. Unlike the reference, a depth of less than eight bits is refused with
`UNSUPPORTED_FEATURE` rather than read with a stride of nothing. A file cut short of the pixels its header
declares is refused with `INVALID_ARCHIVE`.

The tests cover finding a bitmap of the format's own name and declining any other, a file that does not open
with the word of a bitmap, the header it reports, a picture of twenty four bits, a picture whose name is
outside ascii, a picture whose header gives its rows the other way up, a picture of thirty two bits, any other
depth handed the ramp of greys, and a bitmap cut short of its pixels.
