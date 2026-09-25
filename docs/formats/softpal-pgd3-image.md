# Amuse Craft incremental picture (`PGD3`)

Format reference: GARbro `ArcFormats/Softpal/ImagePGD.cs`, class `Pgd3Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

A picture opens with the letters `PGD3` or `PGD2`, the place of the picture on the screen (`u16` at 4
and 6), the width (`u16` at 8), the height (`u16` at `0xA`), the places of the file of a colour of a
place of the picture (`u16` at `0xC`) and the name of the picture of the places of the picture before
the walk of it (of no places of the file of the walk of it above `0x14` of them, at `0x0E`). The count
of the places of the picture of the walk (`i32` at `0x30`), the count of the places of the file of the
walk of the engine (`i32` at `0x34`, unused) and the walk itself stand behind the head of it.

The walk of the places of the picture of the engine stands of the walk of the third walk of the engine
(the places of the file of the picture of the rows of it, of the third walk of the picture of the
engine), of the count of the places of a colour of a place of the picture of the head of it.

The picture of the engine itself stands of the places of the file of the picture of the walk of the
engine walked over the places of the file of the picture before it (`VFS.OpenBinaryStream` of the
directory of the picture of the engine and of the name of the head of it): the places of the file of
the picture of the walk of the engine of this port stand of the XOR of the places of the file of the
picture of the walk of it and of the picture before it, of the places of the file of the picture of the
walk of the engine of the walk of the places of the file of the picture of it of the third walk of the
engine, of the places of the file of a colour of the walk of the engine of the picture before it alone
where the two of them stand of the four places of the file of a colour to a place of the picture of it.
The name of the picture before the walk of the engine must stand of a picture of the fourth kind of the
engine (`GE `), of the places of the file of the picture of the engine of the walk of it.

## What this port does not carry

* **Writing a picture of the engine.** The reference `Pgd3Format.Write` throws.
* **A name of the picture before the walk of the engine outside the file of the picture of the engine
  itself.** The reference walks the file of the engine of the picture; this port stands of
  `UNSAFE_PATH` for an absolute name or a name of the places of the file above it.
* **A picture of the engine of no places of the file of the picture before it.** The reference throws
  `FileNotFoundException`; this port stands of `IO_ERROR`.

## How the walk stands verified

Six walks of our own: the head of the picture of the engine (of the places of the file of it, of the
name of the picture before the walk of it and of a head of no places of the file of it), the walk of the
places of the picture of the walk of it, the walk of the places of the picture of the engine over the
places of the file of the picture before it, the places of the file of a name outside the file of the
picture of the engine itself, a picture of the engine of no places of the file of the picture before it,
and the walk of the places of the file of the picture of the engine of the file of the places of the
picture of the engine itself (of the places of the file of the picture before the walk of it of the file
of the picture of the engine and of the walk of the places of the file of the picture of the engine of
it). The places of the file of the picture of the walk of the engine of this port stand of the XOR of
the places of the file of the picture of the walk of it and of the picture before it, of the places of
the file of the picture of the engine itself.
