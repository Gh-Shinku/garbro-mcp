# Macromedia Shockwave Flash presentation (`SWF`)

Format reference: GARbro `ArcFormats/Macromedia/ArcSWF.cs` (`SwfOpener`, `SwfReader`, `SwfChunk`,
`LosslessImageDecoder`, `SwfJpeg2Decoder`, `SwfJpeg3Decoder`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The first three bytes are `FWS` for a plain file and `CWS` for a file whose body is deflated with zlib;
the fourth byte is the version. The eight byte head is skipped and the body that follows (inflated first
for `CWS`) begins with the display rectangle: five bits give the size of the four values that follow
(x minimum, x maximum, y minimum, y maximum), each stored signed in that many bits. The width and height
are the differences of those pairs.

The reference reads the rectangle bit by bit and then resets its bit reader, so the frame rate (`u16`)
and the frame count (`u16`) stand at the next byte boundary, `(5 + 4 * size + 7) >> 3`. The tag walk
starts four bytes behind them.

Note that GARbro's `Signatures` only match a version byte of eight; detection here accepts any version,
which is what the reference's own `TryOpen` does.

## Tags

Every tag starts with a `u16` header: the type is the value shifted right by six and the length is the
low six bits; a length of `0x3F` means a `u32` length follows the header. `DefineSprite` (39) forces the
length to four. A tag that would reach past the body ends the walk, where the reference lets its reader
run past the end and throw.

An entry is made for every tag whose length is more than two and whose type is one of

| type | tag | kind |
| --- | --- | --- |
| 6 | `DefineBitsJpeg` | image |
| 8 | `JpegTables` | JpegTables |
| 12 | `DoAction` | (empty) |
| 14 | `DefineSound` | audio |
| 20 | `DefineBitsLossless` | image |
| 21 | `DefineBitsJpeg2` | image |
| 35 | `DefineBitsJpeg3` | image |
| 36 | `DefineBitsLossless2` | image |

The name of an entry is `<file base>#<id>` with the id read as a `u16` at the start of the tag body,
padded to five digits, and an extension taken from the kind (`.jpg` for the JPEG tags, `.bmp` for the
lossless ones, `.mp3` for `DefineSound`, `.bin` otherwise). `DefineSound` keeps its `.mp3` extension for
every kind, which is an extension of this port: the reference does not name these entries at all.

The tags of type 18 (`SoundStreamHead`), 19 (`SoundStreamBlock`) and 45 (`SoundStreamHead2`) are not
entries themselves, apart from a head whose flags byte (at offset 1, as the reference indexes it, which
overlaps the low byte of the id) has bit `0x20` set of the two `0x30` bits: that head becomes an mp3
entry and its contents are the payloads, from offset four, of the `SoundStreamBlock` tags that follow it
up to the next sound stream tag.

## Extraction

* `DefineBitsJpeg`, `DefineBitsJpeg2` and `DefineBitsJpeg3` — decoded to a bitmap (below).
* `DefineBitsLossless` and `DefineBitsLossless2` — decoded to a bitmap (below).
* `DefineSound` — for the mp3 kind (the flags byte at offset two shifted right by four is two) the body
  from offset nine, otherwise the body from offset two, which is exactly what the reference returns (it
  computes the sample rate, the sample size and the channel count and then uses none of them).
* every other tag — the body as it stands.

## Pictures kept as a JPEG

Three tags keep a picture as a JPEG, and `SwfOpener.OpenImage` hands each of them to the platform's JPEG
decoder:

* `DefineBitsJpeg` (6) — the picture stands behind the count of the places of the file of it. The reference
  walks the body for the `FF D8` mark of a JPEG and reads from there; this port does the same;
* `DefineBitsJpeg2` (21) — the picture stands behind the places of the file of the walk of it, which the
  reference walks for the mark with `FindJpegSignature`, skipping the `FF D9` and `FF FF D8` shapes on the
  way;
* `DefineBitsJpeg3` (35) — the `i32` at offset two is the count of the places of the file of the picture,
  which stands at offset six; behind it stands the alpha channel of the picture as a stream of zlib,
  unpacked into as many places as the picture holds and laid over the fourth place of every place of it,
  where a stream that stands short of that count leaves nought behind it.

This port reads the JPEG with its own reader of the JPEG interchange format and lays the alpha channel of
the third kind over it in the same way, so a picture of any of the three kinds is handed out as a bitmap
with four bytes a place, named `.bmp`. A body of the first two kinds that holds no JPEG mark, a
`DefineBitsJpeg3` whose count of the places of its picture stands behind the body, and a picture whose
bytes are in no format the reader of this project knows are refused with `INVALID_ARCHIVE`, where the
platform decoder of the reference is handed the stream instead.

## Lossless pictures

The body holds the format byte at offset two, the width (`u16` at 3), the height (`u16` at 5) and then,
for the eight bit format, the number of colours less one at offset seven. Everything behind that is
deflated. The colour table, for the eight bit format, comes first in the inflated data as four bytes per
colour (red, green, blue and then the alpha for `DefineBitsLossless2`; the fourth byte of the other one is
ignored, as `PaletteFormat.RgbX` ignores it), and the places of the picture follow it — the reference
reads both from the same stream one behind the other, which a fixture that keeps the colour table in front
of the places pins.

* format 3 — eight bits, a colour table.
* format 4 — sixteen bits, five bits of red, six of green and five of blue, little endian.
* format 5 — thirty two bits, read as alpha, red, green, blue and written back as blue, green, red, alpha.

The bitmap is written top down (`ImageData.Create` in the reference does not flip its rows), so the first
row of the inflated data is the top row of the picture.

## Tests and deviations

`tests/formats/macromedia-swf.test.ts` builds small files of its own: a plain `FWS` file and the same
file with a deflated body (`CWS`), carrying a `JpegTables` tag, a `DoAction` tag, both JPEG tags of the
first two kinds, a `DefineBitsLossless2` of thirty two bits, a `DefineBitsLossless` of thirty two bits, a
palette picture of eight bits, a picture of sixteen bits, a `DefineSound` of the mp3 kind, a sound stream
head of the mp3 kind with two blocks behind it, a tag of no interest and an empty tag; a picture of the
third kind stands in a file of its own. The fixtures pin the head, the tag walk, the names and kinds, the
places of the pictures of the three JPEG kinds, the decoded bitmaps (both the stored bytes and the colours
through the colour table) and the sound contents.

The reference's `SwfOpener` exposes both an archive side, which hands the places of a `DefineBitsJpeg` over
as they stand, and an image side, which decodes it; this port follows the image side for every picture of
the engine, as it does for the lossless kinds.
