# LiveMaker engine picture of the shape `GaleX200` (`livemaker-galx-image`)

Reference: `ArcFormats/LiveMaker/ImageGALX.cs`, class `GalXFormat`, tag `GAL/X200`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

The head of a picture of this shape is the word `GaleX200`, the count of the places of the XML behind it and
the XML itself, of zlib:

```text
GaleX200                       8 places
the count of the places of the XML   4 places
the XML, of zlib                the count of places named
the places of the frames        behind the XML, at `12 + the count of the places of the XML`
```

The reference reads that XML with `XmlDocument`, after replacing every `<Frame …>` with `<Frame>` - the XML of
the engine carries the counts of a frame twice, "which causes LoadXml to fail", as the reference's own note
says. The counts of the picture come from the `/Frames` node (`Width`, `Height`, `Bpp`, `Version`, `Count`,
`Randomized`, `CompType`, `BGColor`, `BlockWidth`, `BlockHeight`); the counts of every frame come from its
`Frame/Layers` node (`Count`, `Width`, `Height`, `Bpp`), the places of the colours of the picture from the
`RGB` node behind it where the picture stands of eight places of a colour or fewer, and the place of the
count of places of the colour of every count of places from the `AlphaOn` of its `<Layer>`.

Behind the XML the frames stand one behind the other, every frame of the count of the places of each of its
counts of places: the count of places themselves, and then the same again for the places of the colour of
that count of places where the XML names one. Those places stand of the walk of the places of a picture of the
engine itself, which this project carries as `livemaker/gal-image.ts`; this port stands of that walk
(`unpackGalLayer`, `galFrameStride`, `galBitmap`) rather than of a second one.

## The port

`packages/formats/src/livemaker/galx.ts`, of both rows of this shape: `livemaker-galx-image` here, and the other one beside
it. The XML stands parsed by the counts the reference reads, one by one, rather than by a general XML reader
- the XML of the engine is written by the engine, and every count of it stands in an attribute of one of the
four nodes the walk needs.

## Deviations from the reference

* The **places of a picture of the engine itself** where the XML names them (`CompType` of two) stand of
  `JpegBitmapDecoder` in the reference and of no walk here: such a picture stands refused, as it does
  everywhere else this project reads a picture of this engine.
* The walk of the places of a picture of the engine of this project stands of the **first** count of places
  of a frame (as the walk of the picture of the name `GAL` of this project does); the reference folds every
  count of places of a frame into one picture.
* A file of a count of the version behind the counts of the reference (`Version` at `100` behind) stands of
  no walk of this port at all, which is where the reference's own reader answers nothing as well.

## Verification

`tests/formats/livemaker-galx.test.ts` (4 tests), against pictures built in the test: the XML of zlib, the
places of the frames behind it, and a count of the version of one hundred (of which the walk of a picture of
the engine stands of the places of a file as they stand).

* the head: the counts of the picture and of its frames, the places of the frames (of the count of the places
  of the XML of the very file of the test), the `AlphaOn` of the counts of places of both frames, and the
  places of a frame of the engine of a count of the version one hundred as they stand;
* the picture of a file of the shape, handed out as a bitmap of thirty two places of a colour, of the places
  of the first frame of the file;
* every frame of the file as a picture of its own, of its own places of the colours (and of the places of the
  colour of a frame that carries them);
* the refusals: a file of no word of the shape, a file of no XML of this engine, and a frame whose places of
  counts reach past the end of the file.

## The picture of the engine of the kind of the engine itself

Where the XML of the head names the picture of the kind of the engine itself (`CompType` of two), the places of the
count of the places of the frame hold a JPEG stream: the reference hands those places to `JpegBitmapDecoder` of its
platform, and this port reads them with its own reader of that format (`shared/jpeg-image.ts`), standing them of the
counts of the frame of the picture, as the pictures of the shape `GAL` of the same engine stand of them. A picture of
that kind whose JPEG stands of counts the reader of this project does not read, or whose counts of the places of the
file stand of the counts of the frame of the picture of their own, stands turned away, which the record names.
