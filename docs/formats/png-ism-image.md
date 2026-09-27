# ISM engine PNG image (`png-ism-image`)

Reference: `ArcFormats/Ism/ImagePNG.cs`, class `PngIsmFormat`, tag `PNG/ISM`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

A picture of the name `.png` of the engine of ISM, of the walk of the reference:

* the picture itself is a picture of the name `.png`, read with the decoder of the platform
  (`PngBitmapDecoder`) - or, as here, with the reader of that format this project carries
  (`shared/png-image.ts`), which hands out the same places of the colours, blue first;
* where the picture that comes out stands of `Bgra32`, the reference turns the **place of the colour of
  every place of the picture** over (`pixels[i] ^= 0xFF` at `i += 4`) and hands the picture back; a picture
  of another shape stands as it stands.

`Write` throws `NotImplementedException` in the reference: a picture of this kind can be read and not
written.

## The reach of the walk

The reference applies this walk **only inside an archive of its own engine**: `ReadMetaData` answers nothing
unless the file stands inside an archive whose tag is `ISA` (`VFS.IsVirtual && VFS.CurrentArchive.Tag !=
"ISA"` answers `null`), and the format itself stands of the **last priority** of the reference's table
(`[ExportMetadata("Priority", -1)]`), so a picture of the name `.png` that stands alone stands of the format
of that name rather than of this one. The port carries both: the last priority (`priority: -1`) and the walk.

The archive of the engine stands in this project as `ism-isa`, and it **takes the walk of this format**: a
file of the name `.png` of such an archive is handed out by `isaEntryOpener` through `readPngIsmPicture`,
while every other file of the archive stands as its places stand. That is where the walk is reached, the
reference answering for a file of that name only inside an archive of the engine.

## Deviations from the reference

* The picture stands of the reader of this project rather than of the decoder of the platform the reference
  stands of; where the one reader cannot walk a file, this port answers with no picture at all rather than
  with a stream that throws.
* The walk stands of no archive context here: the reference reaches it only from inside an archive whose tag
  is `ISA` and this port stands of the same last priority a whole table does, which comes to the same thing
  for a picture that stands alone.

## Verification

`tests/formats/ism-png-image.test.ts` (3 tests):

* a picture of thirty two places of a colour, of places of the colours worked out **by hand** (`40 ^ 0xFF`
  stands of `215` and `230 ^ 0xFF` of `25`, the places of the colours of the bitmap standing blue first);
* a picture of twenty four places of a colour, whose places stand as they stand (and a file of no picture of
  the name `.png` at all, which stands of no picture of this format);
* the walk through the format itself: the head of the name `.png` at the places of the file, the name of the
  one file of the listing, the places handed out as a bitmap, and a file of no such head refused;
* the walk as the archive of the engine takes it: an archive of the engine of ISM (`ism-isa`) of two files,
  whose picture of the name `.png` stands out as a bitmap of the place of its colour turned over
  (`40 ^ 0xFF` stands of `215`) and whose other file stands as its places stand.
