# Aoi engine image format

Reference: `GARbro/ArcFormats/Aoi/ImageAGF.cs`, classes `AgfFormat`, `AgfMetaData` and the walk inside the
format. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aoi/agf-image.ts` (`aoiAgfImageDescriptor`, `aoiAgfImageFormat`, id
`aoi-agf-image`, `readAgfLayout`, `readAgfBaseName`, `unpackAgf`, `blendAgf`, `readAgfImage`).

The file begins with the word `AGF` — the word the reference registers — the version of the head stands at four
and has to be one or two, the width and the height stand at `0x1C` and `0x20` as words of four bytes, and the
place of the pixels is the word at `0x0C` for the first version and the one at `0x10` for the second. What is
handed out is always a picture of four bytes a pixel.

The pixels stand behind the place the head gives, written by steps of five kinds. Every step begins with a
word whose lowest byte says its kind and whose places above it say how much it writes, counted in pixels:

* the first kind is that many pixels that stand as they are;
* the second is one pixel that stands as it is and is then written again and again until the step is whole;
* the third is a run of pixels that stands as it is and is then written again as many times as the lowest byte
  of the count says — the count holding the length of the run above it — until the step is whole;
* the fourth is a run of pixels copied from behind the one being written, as far behind as the three lowest
  places of the count say and as long as the places above them say;
* the fifth is nothing at all: as many pixels of the file are passed over as the count says, less a quarter of
  them, and the step is as long as the count says. The count of this kind stands in the **second** byte of the
  places above the kind, which is what the reference's own double shift reads.

A copy reads forward byte by byte, so a run may read the pixels it has just written.

The second version of the head may say, with the place `0x10` of its flags, that the picture stands on top of
another picture of the same kind whose name stands behind the pixels: a name of two byte letters ending at a
letter of nought, read against the place of the head and the place at `0x6C`. That picture is read beside the
one at hand — so the name may hold a directory — and written under it: **every pixel of the picture at hand
that is nought in all four of its bytes takes the four bytes of the picture behind it**. A picture behind of
another size is left alone, and a picture that cannot be read is left out, which is what the reference's own
catching of that failure does; a picture that names itself is left out after eight steps rather than walking
into itself for ever, which the reference does not guard against.

Deviations from the reference, in the message only: a step of a kind the walk does not know, a file cut short
of its steps, a run that reaches before the beginning of the pixels and one that reaches past their end are
refused, where the reference would read or write outside its own array or throw an `InvalidFormatException` of
its own. A run of the first kind that the file does not hold in full leaves the pixels behind it as nought,
which is what the reference's own read does.

The tests cover the head of both versions and the name behind it, the marks, versions and sizes it is turned
away for, all five kinds of step including a pixel passed over, a run that stands again and again, the picture
written out as a bitmap, the picture behind written under it both as a run and through a companion file, a
step of a kind it does not know, and a file that does not hold a picture.
