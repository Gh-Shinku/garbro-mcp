# Masys picture (`ACG`)

Reference: GARbro `ArcFormats/Masys/ImageAG.cs`, class `AgFormat` along with the `AgReader` and the
`AgBitStream` it reads through (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).
Implemented as `packages/formats/src/masys/ag-image.ts`, registered as `masys-ag-image`.

## The header

The file opens with the word `AGd`, the width at 4 and the height at 8. From 0x0C follow six sections as an
offset and a size each, and behind that table stand three bytes that seed the picture's first pixel. The
**sixth section is the alpha plane**, and its size is what the reference reads as the alpha size as well:
a picture whose sixth section is empty is twenty four bits deep and one that carries it is thirty two.

## The streams

Five of the sections are read through a bit reader, and every channel of every pixel is built from them:

| section | what it decides |
| --- | --- |
| 1 | whether the channel is a literal byte taken from the fifth section |
| 2 | that byte, which is read one at a time |
| 3 | whether the channel simply repeats the pixel before it |
| 4 | a difference of one to sixteen, taken a nibble at a time |
| 5 | whether that difference is added or subtracted |

So a channel is either a stored byte, the same channel of the pixel before it, or that channel moved by at
most sixteen. The reader takes the **low bit of each byte first** and keeps a marker bit above the eight it
is holding, so a fresh byte is loaded once those eight are spent; two nibbles come out of a byte low one
first.

## The pixels

The channels are stored blue, green and red, and the pixels run from the top left. Two values are measured
against: the pixel just written, and **the first pixel of the row being written**, which the reference puts
in place behind the loop's back, so the first pixel of a row carries on from the first pixel of the row
before it rather than from the end of that row. A difference wraps the way a byte does, which is what the
reference's own `byte` arithmetic does.

## The alpha plane

The sixth section holds one byte a pixel, run length coded: a byte with its high bit set introduces a run of
the seven bits that are left, with a sixteen bit count behind it, and every other byte stands for itself.
The samples are six bits wide and the reference scales them by `0xFF/0x40`, clamped to 255, so the plane
becomes the fourth byte of a thirty two bit pixel whose channels are already in the order a bitmap wants.

## Deviations from the reference

* A section whose range leaves the file, or whose size is below nothing, is refused, where the reference
  would hand its reader an impossible range.
* Each stream is built the first time a channel asks for it, which is what the reference does by leaving
  the sections it does not need unset; a stream that is asked for and missing is refused.
* Where the reference leaves four bytes of slack behind each stream and reads zeros out of them once the
  stream is spent, this port reports the stream as ending.
* A run of the alpha plane that would outgrow the picture is refused, where the reference writes past the
  end of its own plane.
* A picture larger than 256 MiB is refused rather than allocated.

## Verification

Nine fixtures in `tests/formats/masys-ag-image.test.ts` cover every channel read as a literal, the repeat of
the pixel before and of a row's first pixel from the row above, the difference with both directions and its
wraparound at the ends of a byte, the run length coded alpha plane with a stored byte, a run, and a value
that is clamped, the twenty four and thirty two bit bitmaps with their top down height, the listing and its
metadata, and the header shapes and missing streams that are turned away.
