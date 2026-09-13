# SYSD engine DBM bitmap

Reference: `GARbro/ArcFormats/SysD/ImageDBM.cs`, class `DbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/sysd/dbm-image.ts` (`dbmImageDescriptor`, `dbmImageFormat`, id
`sysd-dbm-image`).

| field | offset |
|---|---|
| marker `DM` | 0 |
| file size (`u32`) | 4 |
| width (`u16`) | 0xA |
| height (`u16`) | 0xC |
| packed flag | 0x18 |
| packed size (`i32`) | 0x19 |
| size of the pixels (`i32`) | 0x1D |
| pixel data | 0x21 |

## Three signatures, and the check that makes them safe

`Signatures` holds `0x004D44`, `0x014D44` and `0x044D44`, which decode little endian as `DM` followed by a third
byte of zero, one or four — a version, or a variant the format never looks at again. The `Signature` property is
the two byte `DM` alone, and it is never used for the check; the three registered values are what the dispatcher
gates on. As with every format here, the probe re-checks the marker and the version byte itself, since a direct
call does not go through the dispatcher.

**The metadata read then checks the one thing that really matters:** the word at offset four has to be the
length of the whole file, or the format is refused. That single comparison is what keeps the loose signature
workable, and it turns a truncated file into a decline rather than a partial read — a test checks that changing
only the size word is enough to make an otherwise valid file unrecognisable.

## The stored strides and a bitmap's are different

`Read` computes `stride = width * 24 / 8`, which is three bytes a pixel with **no padding**, and hands it to
`ImageData.CreateFlipped`. A bitmap, on the other hand, requires rows aligned to four bytes. The two agree only
when `width * 3` is already a multiple of four; for the rest the port repacks the rows, and a test uses a
three pixel wide image to show nine byte rows arriving as twelve.

`CreateFlipped` is the bitmap's *own* convention — the data is bottom up and the extracted bitmap records that
as a **positive** height — so the port passes `bottomUp` and does not reverse anything.

## The pixel stream

The flag byte at 0x18 decides the branch; any non-zero value means packed. The size word at 0x19 is read and
then never used — the reference computes `packed_size` and ignores it, so the port does not read it at all, and
this note is the only place it appears. The word that matters is the one at 0x1D, which is how many bytes the
pixels should come to: the buffer is allocated from it and both branches read into that buffer.

That allocation is why a **short stream is not an error**: whatever the codec or the file does not supply stays
zeroed. The port keeps that behaviour on both paths — the codec's output is copied into a zeroed buffer rather
than replacing it, and the raw path copies only the bytes that are there — and a test pins it, including for the
packed case where the stock `LzssStream` simply stops early. The packed branch uses the codec's **default**
frame: 0x1000 bytes, a fill of zero and an initial position of 0xFEE.

A file that reaches the metadata but stops before the pixel header lists and then fails on extraction, which is
where the reference reads its first byte past the end.

## Notes

* The depth is always 24 bits and is not read from the file.
* Neither dimension is validated, so an empty image is accepted and produces a bare bitmap header; the port caps
  the pixel count at 256 MiB, which is a recorded deviation.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
