# Ai5 engine indexed image (GP8)

Reference: `GARbro/ArcFormats/elf/ImageGP8.cs`, class `Gp8Format` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/gp8-image.ts` (`ai5Gp8ImageDescriptor`, `ai5Gp8ImageFormat`, id
`ai5-gp8-image`). The mask of the same file is ported alongside it as `ai5-msk-image`, and the two share their
reader.

An eight bit indexed picture: a palette of a thousand and twenty four bytes and then the pixels as an LZSS
stream.

| offset | field |
|---|---|
| 0 | x, signed |
| 2 | y, signed |
| 4 | width, signed |
| 6 | height, signed |
| 8 | two hundred and fifty six colours of four bytes each |
| 1032 | the pixels, LZSS |

The reference declares **no word of its own** — the file has no signature to check — so a file is its own only if
it holds together as one: it has to be **longer** than its palette (a picture of nothing at all is no picture,
and a file of exactly a thousand and thirty two bytes is refused), both of its positions have to lie within three
hundred of the beginning and both of its measurements within four thousand and ninety six.

## The palette

The reference makes a colour of the **first three bytes** of each entry and drops the fourth, so a bitmap palette
takes blue, green and red as they stand with nothing where the fourth byte was. The port builds the bitmap
palette that way rather than copying the file's four byte entries through.

## The pixels

Behind the palette is an LZSS stream of exactly one byte per pixel. The reference reads it into a buffer of that
length and refuses anything else, so a stream that stops short is an **error** rather than a picture whose tail
is left black — which is how this reader differs from the Ai5 compressed picture (`ai5-rmt-image`), whose
reference ignores what its read returned. Input behind the last pixel is never read, so a file may carry anything
after its picture.

The picture is built with `ImageData.CreateFlipped`, which stores its rows bottom up; the port writes a bitmap
with a **positive height** at the same place.

The tests cover the measurements and the positions the reference allows, an offset just past what it allows, a
file of exactly the length of its palette and one with no room for a header at all, the palette with its fourth
byte dropped, the pixels behind the whole palette with their rows aligned, a stream that carries less than the
whole picture, and bytes behind the picture that are never read.
