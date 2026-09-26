# AliceSoft JPEG image

Reference: `ArcFormats/AliceSoft/ImageAJP.cs`, class `AjpFormat` (tag `AJP`). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `alicesoft-ajp-image`
(`packages/formats/src/alicesoft/ajp-image.ts`).

## The head

The picture opens with the word `AJP` and a head of thirty-six bytes: the version of the format, the size of
the picture, the place and length of its **JPEG** run, and the place and length of its **alpha** run. A
version above nothing adds the size the alpha takes once it is unpacked, and a version below nothing is not a
picture of this engine at all.

Both runs begin with sixteen bytes exclusive-ored with a key the engine fixes; everything behind those
sixteen bytes stands as it is. The key covers the whole of those sixteen bytes even when a run is shorter,
so every byte handed over is a keyed one.

## The alpha run

The alpha channel is a run of its own, and it is what the picture is worth keeping when the JPEG itself
cannot be decoded:

```text
a byte below 0xF8   stands for itself
0xF8                the byte behind it stands for itself
0xFC                a count byte, then two bytes copied over and over: count * 2 + 4 of them
0xFD                a count byte and a byte, filled over and over: count + 4 of them
0xFE                a count byte, then that many bytes copied from two rows above
0xFF                a count byte, then that many bytes copied from the row above
```

Behind the run stands a palette of three bytes a colour, at the place the head names. The run's own bytes are
**indices** into it: every channel of a colour is added and divided by three, so what comes out is the grey of
that colour rather than the index itself.

## The picture

The reference decodes the keyed JPEG with the platform's decoder, lays the alpha channel over the fourth byte
of every pixel and hands one picture back. This port decodes the JPEG with its own reader of the JPEG
interchange format and lays the channel over it the same way, so a picture of this engine is one bitmap with
four bytes a pixel.

The channel comes from one of two walks, of the count of the places the head names:

* where that count stands above nothing, the run is a **zlib stream** of that many bytes of alpha. The
  reference reads it into a buffer of that count, so a stream that stands short of the count leaves the
  places behind it at nought; this port does the same;
* where the head names no count, the run is the alpha run of its own, walked and paletted as above.

The frame of the JPEG is read with the row length of the head of the picture, exactly as the reference does
through `CopyPixels`, so a frame larger than the head keeps the places of the picture itself alone. A frame
smaller than the head, and a channel that holds fewer places than the picture, are refused: the reference
would walk past the buffers it read them into.

## Deviations from the reference

* The reference hands the JPEG to the platform's decoder, which reads every format the platform knows; this
  port reads the JPEG interchange format itself and refuses a run that is in no such format.
* A frame of fewer than four bytes a pixel, whose fourth byte the reference takes from the decoded surface
  before the alpha channel is laid over it, gains an opaque fourth byte here, since the reader of this project
  hands out four bytes a pixel for every JPEG.
* A run that reaches past the file, a version below nothing, a picture of no size, a picture whose own header
  the frame of the JPEG cannot fill, an alpha run whose marks are not ones the engine writes, and a head that
  names fewer places of the alpha than the picture holds are all refused. The reference reads through the end
  of its own view in places.
* Every read is bounded to the file.

## Verification

Nine tests: the head read back field by field; the key, checked byte by byte against the key the engine
fixes - both for a run longer than it, where the bytes behind it must stand as they are, and for a run
shorter than it, which is keyed through its whole length; the alpha run unpacked for each of its five marks
at once, with one byte of the fixture whose palette colour is not itself, so the grey of that colour comes
out rather than the index; the picture of one member, with the alpha channel of the run of its own laid over
its places; the same with the channel of a zlib stream, including a stream that stands short of the count of
the head, whose places behind it must stand at nought; the refusals, of a run of no JPEG and of a head that
names fewer places of the alpha than the picture holds; and the word of the picture.

The JPEG of the fixture is the recorded stream of eight places square that the other rows of this project use
as their oracle, so the places of the picture are the ones that stream decodes to, widened to four bytes a
pixel. What stands on the reference alone: no real picture of this engine is on hand to compare against
GARbro's output.
