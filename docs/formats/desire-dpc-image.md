# Desire DPC image

Reference: `GARbro/Legacy/Desire/ImageDPC.cs`, class `DpcFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/desire/dpc-image.ts` (`dpcImageDescriptor`, `dpcImageFormat`, id
`desire-dpc-image`). The pixels are decoded by `packages/formats/src/system98/gra-reader.ts`, the shared
`GraBaseReader` port used by the System98 `G` and Desire `DES` formats as well.

| field | offset |
|---|---|
| left (`i16`) | 0x20 |
| top (`i16`) | 0x22 |
| width (`u16`) | 0x24 |
| height (`u16`) | 0x26 |
| sixteen palette words | 0x28 |
| bit packed stream | 0x28 |

Two things distinguish this from its siblings:

* **the palette and the stream start at the same offset.** `Read` reads the sixteen colour words first and
  then seeks back to `0x28` for the compressed data, so those thirty two bytes are both the palette and the
  first bytes of the stream. The port does the same, and a test proves the overlap rather than assuming it:
  with a zero palette the decode matches the traced zero stream exactly, while a palette of non-zero words
  produces a different image *and* the expected colour entries;
* **the colour words are packed rather than triples.** Each word holds green in the top nibble, red below it,
  blue below that and an alpha flag in the low bit; every channel is widened by `0x11`. The port converts
  them into the RGB triples `writeBmp4` expects, dropping the alpha flag, which a four bit bitmap cannot
  carry. A test builds words whose three channels are all different functions of the index, so a swapped
  channel would fail.

The geometry rules differ from the siblings too: there is no multiple of eight requirement and no 640 by 400
bound; instead the source rectangle is checked against a 2048 square canvas, and a negative origin is
rejected. The reference gates on the `.DPC` extension *before* reading anything, so the descriptor registers
no signature and the extension check lives in detection — extraction runs only for entries detection already
accepted, so it reads the fields without repeating the gate. Tests cover both the gate (a `.DES` name with
DPC content is declined, a lower case `.DPC` name is accepted) and the canvas rules.

The port exposes the resource as a single entry:

* the pixels are written as a **four bit palette bitmap** by `writeBmp4`, keeping the source depth;
* `Read` uses `ImageData.Create`, so rows stay top down and the bitmap takes a **negative** height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 4`; the archive metadata records
  `image: "bmp"`, the dimensions, the bit depth, `colors: 16` and the source rectangle as `offsetX`/`offsetY`.

Declines, all tested: zero dimensions, a rectangle overhanging the canvas in either direction, a negative
origin and a file that stops inside the header.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
