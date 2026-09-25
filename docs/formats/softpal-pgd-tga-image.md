# Amuse Craft TGA picture

Format reference: GARbro `ArcFormats/Softpal/ImagePGD.cs`, class `PgdTgaFormat` (a walk of the TGA
picture of the engine itself), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A picture opens with the place of the picture on the screen (`i32` at 0 and 4, of no places of the file
above `0x2000` of them), the width (`u32` at 8) and the height (`u32` at `0x0C`), which must stand of
the same places of the file as the width and the height of the TGA head of it (`u16` at `0x24` and
`0x26`, of the places of the file of the TGA head at `0x18` of the picture of the engine). The places
of the file of the TGA picture of the engine stand at `0x18` of the picture of it; the reference hands
them to its own TGA reader, and this port hands them to `renderTgaImage` and returns the places of the
file of a BMP of it. The places of the file of the picture of the engine stand of the head of the
picture of the engine itself, of no places of the file of the picture of it of the walk of the engine.

## What this port does not carry

* **Writing a picture of the engine.** The reference `PgdTgaFormat.Write` throws, and `CanWrite`
  stands of no places of it.
* **A picture of the engine of the places of the file of the picture of the engine of no places of the
  file of the picture of the walk of the engine itself.** This port stands of `INVALID_ARCHIVE` for it.

## How the walk stands verified

Three walks of our own: the head of the picture of the engine (of the places of the file of it, of the
places of the file of the picture of the TGA head of it and of the two places of the file of the head of
it above `0x2000`), the walk of the places of the file of the TGA of it (of the two rows of the places
of the file of the BMP of it), and the walk of the places of the file of the picture of the TGA before
the walk of the engine of it.
