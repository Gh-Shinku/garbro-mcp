# Ai5 engine RGB image (G24)

Reference: `GARbro/ArcFormats/elf/ImageG24.cs`, class `G24Format` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/g24-image.ts` (`ai5G24ImageDescriptor`, `ai5G24ImageFormat`, id
`ai5-g24-image`). The stored mask of the same file is ported alongside it as `ai5-msk16-image`.

A true colour picture of eight bytes of header and an LZSS stream of rows, whose depth the **name of the file**
decides rather than anything inside it.

| offset | field |
|---|---|
| 0 | x, signed |
| 2 | y, signed |
| 4 | width, signed |
| 6 | height, signed |
| 8 | the pixels, LZSS |

The reference declares **no word of its own**, and reads a name that ends in `.G16` as a picture of sixteen bits
and one that ends in `.G32` as a picture of thirty two; anything else — `.g24` among them — is a picture of twenty
four. The comparison disregards case. The port takes the depth from the **source** name rather than the name of
the entry it reports, which is a bitmap.

Both measurements have to lie between one and four thousand and ninety six, and both positions within two
thousand and forty eight of the beginning — the reach of the mask of the indexed kind rather than the narrower
one of the picture beside it.

## The rows

A row of the stream carries its pixels aligned to **four bytes**, so a row of three pixels of twenty four bits
takes twelve bytes and a row of one pixel of sixteen bits takes four. The reference reads a whole number of such
rows and refuses anything shorter, then hands the buffer to the bitmap builder with the row length as its stride —
the padding is never part of the picture.

The port inflates into a buffer of padded rows, then copies the pixels of each row into a tight buffer, which the
bitmap writers pad themselves; the picture is the same either way and only the bytes of the container differ.

The picture is built with `ImageData.CreateFlipped`, which stores its rows bottom up; the port writes a bitmap
with a **positive height** at the same place, of twenty four bits, thirty two bits or — for the depth of sixteen
— sixteen bits with the five bit masks the reference's own `Bgr555` stands for.

The tests cover the depth of each of the three names and of a name that is none of them, the measurements and the
positions the reference allows, rows the stream pads and a picture that stays tight, the three depths as bitmaps,
and a stream that carries less than the whole picture.
