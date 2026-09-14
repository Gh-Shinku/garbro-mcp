# Digital Works texture

Reference: `GARbro/ArcFormats/DigitalWorks/ImageTX.cs`, class `TxFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/digital-works/tx-image.ts` (`digitalWorksTxImageDescriptor`,
`digitalWorksTxImageFormat`, id `digital-works-tx-image`).

A **block interleaved texture**. The file starts with `TX` — the two characters the reference actually compares
— and then words, of which one is unusual:

| field | offset |
|---|---|
| `TX` and the low byte of the width block count | 0 |
| width in blocks of 0x100 pixels (`u16`) | 2 |
| height in blocks of 0x100 pixels (`u16`) | 4 |
| depth in **bytes** a pixel, one to four | 6 |
| blocks, a row at a time | 0x10 |
| palette, eight bit textures only | behind the blocks |

The width block count **shares its two bytes with the marker**: its low byte is the marker's third one, which is
why the two words the reference registers — `0x00035854` and `0x00025854` — stand for exactly three and two
blocks of width. Its signature list ends in the zero that makes the format reachable **by extension** as well,
and the extensions it declares are `tmx` and `tx`, so a file with either name is taken as long as its marker and
depth are sound, whatever its third byte says.

The pixels are stored **a 256 by 256 block at a time**, the blocks walking left to right and top to bottom and
each block a row at a time. An eight bit texture carries its palette **behind** the pixels — the opposite of the
CLM image, which puts one in front — in four bytes an entry in blue, green, red and alpha order, which is the
`PaletteFormat.BgrA` the reference asks the library for. A bitmap palette has no use for the alpha byte, so the
port clears it.

Details worth recording:

* the depth is stored in bytes and the reference accepts one to four of them, but the bitmap it builds knows only
  eight, twenty four and thirty two bits, so a **sixteen bit** texture is described and then fails when it is
  read, which the port reproduces;
* a palette that does not fit behind the pixels fails, as the library's reader throws there;
* `ImageData.Create` is called with the depth's own stride and no flip, so the bitmap is **top down** with tight
  rows;
* a body that stops short leaves the pixels it did not reach as zeroes, which is what the reference's unguarded
  reads amount to.

The tests cover the two registered words, the extension pass, the marker and depth checks, the block measured
metadata, a single block, two blocks side by side, two block rows, the palette behind an eight bit body, the
thirty two bit path with the sixteen bit refusal, and the entry name.
