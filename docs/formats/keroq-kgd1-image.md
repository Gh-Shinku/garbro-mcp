# KeroQ image format (KGD1)

Reference: `GARbro/Legacy/KeroQ/ImageKGD1.cs`, classes `Kgd1Format` and `Kgd1MetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/keroq/kgd1-image.ts` (`keroqKgd1ImageDescriptor`,
`keroqKgd1ImageFormat`, id `keroq-kgd1-image`, `readKgd1Layout`).

The file begins with the word `KGD1` and a header of twenty four bytes behind it: the depth as a word at six —
**eight or twenty four bits only** — the width at eight, the height at twelve and the length of the
transparency at sixteen. Nothing else is read, and the depth is what the reference gates on, so a file of any
other depth is not claimed. The reference builds an empty image from a width or height of nothing, which
nothing can be drawn from, so such a header is declined here.

The body behind the header holds, in order:

* the **transparency**, when the length at sixteen is not nothing: as many bytes as it says, one for each pixel
  rather than one for each byte of the picture. A length that is negative, or that the file does not hold, is
  refused where the reference's own reading of it would throw; a length shorter than the picture holds is
  refused as well, because the reference would run off the end of it while it works;
* the **colour map** of an eight bit picture: two hundred and fifty six entries of four bytes, in the order the
  reference reads them, and written back unchanged;
* the **pixels**: width times height times the depth in bytes, with no padding between the rows, top row first.

A picture without transparency is written as an ordinary eight or twenty four bit bitmap; a picture with it is
written as a thirty two bit one whose alpha byte is the **opposite** of the stored byte, `~value`, which is
what the reference does when it hands the pixels to `PixelFormats.Bgra32`. An eight bit picture with
transparency takes the colour of every pixel out of the colour map and its alpha out of the transparency by
the **pixel index**, which is what the reference does in both of its branches. Nothing here writes the format.
A picture above `0x10000000` bytes is refused with `LIMIT_EXCEEDED`, where the reference would allocate and
fail.

The tests cover finding a picture behind the word of the format, declining each depth the reference does not
read, what the header says about the picture, a twenty four bit picture, an indexed picture with its colour
map, the transparency of a twenty four bit picture, the colour and transparency of an indexed one, a picture
cut short of its pixels, an indexed picture cut short of its colour map, and a transparency that does not
cover its picture.
