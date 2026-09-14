# AI6WIN image (AKB)

Reference: `GARbro/ArcFormats/Silky/ImageAKB.cs`, class `AkbFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/silky/akb-image.ts` (`silkyAkbImageDescriptor`,
`silkyAkbImageFormat`, id `silky-akb-image`), with the shared `listCompanionFiles` in
`packages/formats/src/shared/companion.ts`.

An image behind the word `AKB `, or `AKB+` for one that is drawn **over** another — the plus sign is the fourth
byte of the word and nothing else about the header differs. The header is `0x20` bytes:

| field | offset |
|---|---|
| width, height | 4, 6 |
| flags: bit 30 set means 24 bits, clear 32; bit 31 set means the fourth byte is an alpha value | 8 |
| a colour, four bytes | 0x0C |
| the overlay's offset across and down | 0x10, 0x14 |
| the overlay's right and bottom edges | 0x18, 0x1C |

The overlay's own size is the difference between its edges and its offsets, and the reference returns nothing at
all — so the word alone does not find the format — when that size reaches outside the image. Its pixels begin
either right behind the header or, for the incremental kind, behind a name field of `0x20` bytes at `0x20`, which
puts them at `0x40`: the library's own `ReadCString` stops the **name** at its terminator but always steps over
the whole field.

The pixels are an LZSS stream of the library's default kind — a frame of `0x1000`, start at `0xFEE`, filled with
zeroes — read a whole row at a time, so a stream that runs out before the last row fails the way the reference's
own `InvalidFormatException` does. Two more things happen to them, in this order:

* the stream carries its rows **bottom up** and the reference reads the first of them into the **end** of its
  buffer, so the bitmap ends up turned the right way up;
* the rows are then unfolded from their deltas: the topmost row is a difference from the pixel before each one
  and every later row a difference from the row above, both of them byte by byte, with the reference's own
  wrapping byte arithmetic.

Then the overlay is drawn onto an image, which is made in one of two ways:

* an incremental image looks for **another image of the same name** — the name the header carries with its
  extension dropped and any extension allowed — beside it, skipping the file being read, and takes the first
  candidate that is one of these with the same depth, width and height. The reference's own note says a base
  that is itself incremental is unpacked as if it were not, and that is what happens here too;
* otherwise the image is the colour the header names, copied into the first row and unfolded down the whole of
  it in one overlapping copy, or black when that colour is zero.

The drawing differs on whether such a base was found:

* **with** a base, a pixel of pure green — red and blue zero, green `0xFF`, the same key the other Silky formats
  use — is left alone and the base shows through, while every other pixel is written over it;
* **without** one, whole rows are copied over the background as they stand. The key is not consulted at all,
  which is why an overlay that is smaller than the image it is drawn on **covers** its own header colour rather
  than letting it through.

An overlay the size of the whole image and without a base is returned as it is, and its header colour is never
used at all — the reference returns before it builds a background, which is worth knowing because that colour is
still there in the header.

Deviations from the reference, all for input it would fail on anyway:

* a zero width or height is refused here, as is a header that stops before the fields it reads;
* an overlay whose offsets place it outside the image — which the reference only reaches after its own check,
  because a **negative** offset passes it — fails with a message of its own;
* the candidates the search finds are tried in sorted order, where GARbro's own file system order is whatever it
  happens to be, and a directory the name carries is resolved against the file being read.

The tests cover both words, the missing extension and the overlay that does not fit its image, the measurements
with the offsets, the overlay size, the header colour, the name field and the alpha flag, a full size overlay
turned the right way up, a long delta, an overlay drawn at an offset onto the colour its header names, the green
key over a base found beside the file, a missing base, a base of the wrong size, an overlay with nothing in it,
a stream that runs out, a thirty two bit body and the entry name.
