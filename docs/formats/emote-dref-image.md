# `emote-dref-image`

A compound picture of the E-mote engine: a picture that stands of no places of its own, but of the places of
the pictures of other archives. The port is read from `ArcFormats/Emote/ImageDREF.cs`, class `DrefFormat`, at
GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The format

A file holds nothing but a text, one line for every layer of the picture, of the shape
`psb://<archive>/<object>`: the first part names an archive of the engine beside the file, and the second an
object of that archive. The text stands of the places of the file of one place each where the file begins of
the word of such a text, and of the places of the file of two places each where it begins of none (which is
what the reference's reader stands of). The reference refuses the whole picture where a line stands of no
such place, where an archive of a line stands nowhere beside the file, and where a line stands of no object
of its archive.

## What the port does with a picture

Every archive of a line stands opened with the container of the engine (`emote-psb-archive`), the object of
the line stands found of its name, and the places of the object stand of a picture: of the kind the archive
names where the object stands of a picture of the engine (`psb-texture.ts`), and of a **bitmap** where it
stands of an object of no picture of its own, which is the walk the reference stands of as well
(`ImageFormatDecoder.Create`). The first layer stands of the picture itself, of its counts and of its
places; every layer behind it stands drawn over the picture of the layers before it.

## The drawing of a layer

The reference draws a layer of the counts of the places of the file of `WriteableBitmap`
(`DrefFormat.BlendLayer`), and this port stands of the same counts:

* a place of a colour of the layer of a covering place of the **whole** of it stands as it stands;
* a place of a colour of a covering place of **nought** stands of nothing at all;
* a place of a colour between the two stands of the counts of the places of the file of the layer and of the
  picture behind it, of the whole of the count of the places of a colour taken off;
* the covering place of the picture stands of the **greater** of the covering place of the layer and of the
  covering place it stands over.

The places of a layer that stand past the side or the foot of the picture behind them stand of nothing, which
is the walk of the reference's own rectangle as well.

## Deviations

* The reference opens the archives of its lines through the virtual file system of the reference and its
  table of the places of the resources; this port resolves them **beside the file it was given**, which is
  the directory the reference combines the names with as well.
* The picture of an object of a kind this project carries no walk of stands refused rather than read: an
  object of no picture of its own stands of a **bitmap** alone here, where the reference stands of the
  platform's decoder for whatever the places of the object stand of.
* The reference's `Write` throws, and so this port carries no writer.

## Verification

`tests/formats/emote-psb-reader.test.ts` builds the halves in the test: a file of two lines, one of the two
words of the places of the file of one place each and one of two, of one archive and of another beside it,
and archives of the container of the engine whose objects stand of bitmaps built in the test. The lines of
the file stand pinned (of both words, and of a file of no such line standing refused), the drawing of a layer
of a covering place of half of the whole of it stands pinned of the counts of the places of the file worked
out by hand, together with the places of the layer that stand past the side and the foot of the picture
behind them, and the picture itself stands read of the archives the file names, of its counts and of the
places of its file.
