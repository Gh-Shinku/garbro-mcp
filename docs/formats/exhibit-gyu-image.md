# ExHIBIT engine image (`GYU`)

* Reference: `GARbro/ArcFormats/ExHibit/ImageGYU.cs` (`GyuFormat`, `GyuReader`)
* Port: `packages/formats/src/exhibit/gyu-image.ts`, record `exhibit-gyu-image`
* Tests: `tests/formats/exhibit-gyu-image.test.ts`

## Layout

Offset 4 holds the head (little endian): flags (u16), compression mode (u16), key (u32), bits per pixel
(i32), width (u32), height (u32), data size (i32), alpha size (i32), palette size (i32). The colour map
follows at 0x24, `paletteSize` entries of four bytes (B, G, R, unused), then `dataSize` bytes of colour
data, then the alpha.

Stride is `(width * bpp / 8 + 3) & ~3`. Depth is 32 (Bgr32), 24 (Bgr24) or 8 (Indexed8), and a picture with
an alpha size is 32 bit BGRA whatever its depth. An 8 bit picture without a colour map is refused, as in
the reference.

## Colour data

* key `0xFFFFFFFF`: stored as is. Any other key is undone first: ten swaps of two places chosen by
  `MersenneTwister(key)` — `index = rand() % length`, two draws per swap.
* mode `0x100`: the data is stored uncompressed.
* mode `0x800`: the engine's own runs. Colour data starts with four skipped bytes, then the first output
  byte as is, then control bits and bytes interleaved over one stream: a set bit is a literal byte, a clear
  bit is a run. The run selects a short form (2 to 5 places, offset `-256 | byte`) or a long form (a 16 bit
  count naming an offset from `-8192` to `-1`, and either a length in the low three bits or a following
  length byte; a zero length byte ends the walks).
* any other mode: an LZSS stream (`LzssStream`, i.e. the project's `inflateLzssAll`, frame 0x1000, fill 0,
  initial position 0xFEE), which must produce exactly `stride * height` places.

## Alpha

For every row, `(width + 3) & ~3` alpha bytes are read, either as stored (`alphaSize == alphaStride *
height`) or through an LZSS stream. The result is written tightly at four bytes per pixel; for an 8 bit
picture the colour map entry stands in for the three colour bytes. With `flags != 3`, an alpha below 0x10
is multiplied by 0x10 and any other value becomes 0xFF.

## Deviations

* **No key of its own.** Where the head names key 0 the reference asks the user for the game's key; the
  port refuses the extraction with `UNSUPPORTED_FEATURE`. The head can still be listed.
* **Colour map size.** More than 256 entries are refused with `INVALID_ARCHIVE`; the reference's
  `BitmapPalette` throws in that case.
* **Places past the end.** The run reader of this project reads bytes past the end of the colour data as
  noughts; the reference's bit stream returns -1 and throws.
* **Row order.** The reference hands the picture over through `ImageData.CreateFlipped`, so the port hands
  it over as a bottom-up bitmap.
