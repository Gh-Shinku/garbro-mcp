# Uran NCL image

Reference: `GARbro/Legacy/Uran/ImageNCL.cs`, classes `NclFormat` and `NclMetaData` (Uran multi-frame image).
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.

Implementation: `packages/formats/src/uran/ncl-image.ts` (`uranNclImageDescriptor`, `uranNclImageFormat`, id
`uran-ncl-image`). The archive of the same engine is ported beside it as `uran-ncl`, and shares the byte
subtraction the two of them pack their data with.

The reference registers a single **zero** signature, which offers the format every file it is tried on, and
decides everything else with the extension `.NCL`; the port keeps that shape, with the extension checked inside
the reader.

| offset | field |
|---|---|
| 0 | the size of the packed data |
| 4 | four bytes the reference never reads |
| 8 | the length of the stored path |
| 10 | that path, which has to name a bitmap |
| 10 + length + 4 | the size of the header that follows, nine to sixty four bytes |
| 10 + length + 6 | that header: a byte, the width, the height, then its own padding |
| that far in | the packed data |

## The packed data

Every byte of the data has ten **taken off** it before it means anything, which is the subtraction the archive
of this engine uses. Behind that is one method byte:

* `2` — the rest of the data is a deflate stream, which holds the bitmap;
* anything else — the rest of the data is the bitmap itself.

The method byte is read either way and is never part of the bitmap, which the port keeps: a bitmap stored
without one is refused, as it is by the reference.

## The bitmap

The packed data holds a bitmap, which the reference hands to the framework's bitmap decoder and returns as it
comes; the port reads it back with the shared bitmap reader and writes it out again at the depth it was stored
in, so an eight bit picture keeps its colour map and a sixteen bit one keeps its colour masks.

Two things differ from the reference and both are about input the reference would not meet in a game: a bitmap
whose layout the reader here does not know — a run length one, say — is refused with `INVALID_ARCHIVE` where the
framework the reference uses would decode it, and the measurements reported for the entry are the ones the
file's own header carries, which for a well formed file are the bitmap's. The picture that comes out carries the
measurements of the bitmap it was written from.

## Failing

A file whose stored path does not name a bitmap, whose packed data does not fit behind its own header, or whose
data holds no bitmap the reader knows is refused with `INVALID_ARCHIVE`, and so is a deflate stream that does not
unpack or unpacks to more than the port will hold.

The tests cover the extension and the stored path that decide the format, the picture read straight out of the
data and the one behind a deflate stream, the colour map and the colour masks coming through, a bitmap of
another depth, data packed with the wrong key, a bitmap standing where the method byte belongs, and a deflate
stream that does not unpack.
