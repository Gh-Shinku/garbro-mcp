# LiLiM / Le.Chocolat compressed bitmap (ABM)

The image side of the ABM container: a bitmap header with a mode word where a bitmap keeps its bit depth, and six
different ways of storing the pixels behind it. The archive half — the frame listing — lives in
[`lilim-abm`](./lilim-abm.md) and shares the same reference class.

## Reference

| Element | Value |
| --- | --- |
| Tag | `ABM` |
| Class | `AbmFormat` (`ArcFormats/Lilim/ImageABM.cs`), decoder `AbmReader` (`ArcFormats/Lilim/ArcABM.cs`) |
| Signature | None — the file starts with an ordinary bitmap header, and the mode word is the discriminator |
| Header | `0x46` bytes, of which everything up to `0x36` is a bitmap header |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 2 | `BM` |
| `0x02` | 4 | Declared uncompressed size |
| `0x0A` | 4 | Frame offset for the uncompressed modes |
| `0x12` | 4 | Width |
| `0x16` | 4 | Height |
| `0x1C` | 2 | Mode, read as a **signed** word — the bitmap's bit depth field |
| `0x36` | 1024 | Palette, for the eight bit modes |
| `0x3A` | 2 | Frame count, for modes one and two; more than `0xFF` is declined |
| `0x42` | 4 | Frame offset for modes one and two |

The metadata reports a bit depth of eight for mode `8` and twenty four for **every other** mode, including the
thirty two bit ones and `-8`; that is what the reference does, and the extraction's real depth is the mode's.

## Modes

| Mode | Declared depth | Data at | Decoding |
| --- | --- | --- | --- |
| `1` | 24 | `0x0A` | The stored bytes are the image, copied as they are |
| `2` | 24 (32 out) | `0x42` | Four signed frame dimensions, a position byte, then the thirty two bit stream |
| `8` | 8 | `0x0A` | The stored bytes are palette indices |
| `-8` | 24 (32 out) | `0x0A` | An index stream with a per pixel alpha |
| `24` | 24 | `0x0A` | The twenty four bit run stream |
| `32` | 24 (32 out) | `0x0A` | The thirty two bit stream, with alpha woven in |

A file whose declared size word is zero, **or equal to its own length**, is declined for all modes except one and
two: that is how an ordinary bitmap is filtered out. A frame offset at or past the end of the file is declined too.

## Codecs

The **twenty four bit stream** is a marker format. A zero marker skips the count that follows it, a `0xFF` marker
copies that many literal bytes, and any **other** marker announces a single literal: the byte that follows is
stored and the marker's own value is discarded. A marker whose count is zero consumes its two bytes and does
nothing. Skips are not clamped, so an oversized one simply runs past the image and ends the loop.

The **thirty two bit stream** is the same format with a component counter. A literal takes one payload byte and,
every third one, the marker's own value is stored as the alpha of that pixel; a `0xFF` run stores opaque alpha; a
skip steps the position component by component, so it also steps past an alpha slot when it lands on one. Only the
run is bounded by the image; a skip can overshoot.

The **eight bit alpha stream** uses the same markers differently again: the marker byte of a single literal is the
alpha of that pixel, `0xFF` is a run of opaque pixels and zero is a skip. Nothing is clamped there — the reference
would write past its arrays — so the port fails on a run that does not fit instead.

The **mode two frame** has four signed dimensions; a negative origin, an empty size, or a frame past the 256 MiB
ceiling fails. The reference stores the frame's pixels under the dimensions the *header* declared; this port writes
them under the frame's own dimensions, which is what those pixels are, while the metadata keeps reporting the
header's.

## Output

Every mode produces a bitmap: eight bit with the palette copied verbatim (the reference reads blue, green, red and
a spare byte), twenty four bit for modes `1` and `24`, and thirty two bit for modes `2`, `-8` and `32`. All of them
are written top down, and the row stride is the bitmap's own, so a tight stored row is padded on the way out.

## Not ported

The reference's `AbmReader` can also overlay a single frame onto a larger image, but that path needs a
`FrameOffset` — the archive's per-frame metadata — which `ReadMetaData` never sets. A standalone file never reaches
it, so `CopyFrame` and the overlay branch of `Unpack` are not ported.

## Process notes

Five of the nine tests failed on their first run, all of them from the fixtures rather than the port:

* the palette belongs at `0x36`, **inside** the region the metadata is read from — putting it between the header
  and the pixels made the decoder read the palette as its stream;
* the row arithmetic again: a six pixel image at twenty four bits is eighteen bytes, not six;
* two expectations were written from the intended pixels instead of the stream: a run's payloads are **indices**,
  so a run of `0x02, 0x01` paints index two and then index one, and the eight bit case copies all four of its
  bytes rather than three and a zero.
