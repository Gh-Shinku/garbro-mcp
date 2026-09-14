# Silky's RGB image

Reference: `GARbro/ArcFormats/Silky/ImageMFG.cs`, class `MfgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/silky/mfg-image.ts` (`silkyMfgImageDescriptor`,
`silkyMfgImageFormat`, id `silky-mfg-image`).

A **plain bitmap with a manual stride**: the file starts with `MFG_`, `MFGA` or `MFGC` (the reference's
words 0x5F47464D, 0x4147464D and 0x4347464D, the fourth byte being the flavour), then a twenty byte
header of little endian words: the length of the pixel data (`0x04`), the width (`0x08`), the height
(`0x0C`) and the **stride** each row occupies (`0x10`).

The reference derives the depth from the stride rather than storing it — `bpp = stride * 8 / width` with
integer division — and then picks **24 bits only when that comes out to exactly 24** and **32 bits
otherwise** (`PixelFormats.Bgr24` / `Bgra32`). Two consequences the port keeps:

* a stride of `3 * width` is the only way to a 24 bit image; any other padding makes the depth come out
  wrong, so five pixels in eight bytes divide out to twelve bits, which the reference reports as is in
  the metadata and then hands over as a 32 bit image;
* the reference builds the image with the stride it read, so its rows are not tight. The port repacks the
  rows tight for the bitmap it writes and pads a row narrower than the depth it chose with zeroes, where
  the reference would fail in the image layer — a documented deviation for an unusual header, not for a
  well formed file.

Everything that is not `MFG_` carries a **palette block per row** between the header and the pixels: a
count and then that many eight byte entries, which the reference seeks past without reading. The port
skips them the same way, and a block that runs past the end of the file fails.

Also faithful:

* `stride < width` is what the reference rejects outright when it reads the metadata, and it is what the
  port's `readLayout` refuses;
* `stride * height != data_size` makes the reference return no metadata at all, so such a file is not
  detected;
* the pixel buffer has to be complete: the reference throws when its read comes up short, and so does the
  port;
* the image is handed over as a **top down** Windows bitmap — the reference never flips, so the height
  stays negative — and the `mfp` extension is the reference's own made-up one.

The tests cover the three markers, the length and stride checks, the derived depth (24, and twelve for a
padded row), a 24 bit image with its row padding, a 32 bit image, the per-row palette blocks of `MFGA`
and `MFGC`, the padding of a narrow row, the short bodies, and the entry name.
