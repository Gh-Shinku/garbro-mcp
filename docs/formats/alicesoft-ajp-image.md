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

## What this port does that the reference cannot

The reference **composites** the alpha run into the picture it decodes from the JPEG run, and hands one
picture back. Decoding JPEG is not something this project does, so this port keeps the two runs apart and
lists them as two entries:

* the **picture** - the keyed JPEG handed over as it stands, for a caller that can decode it;
* the **alpha run** - its own picture of one grey byte a pixel, written as a bitmap.

That is a deviation of shape rather than of reading: the same bytes are keyed, the same run is unpacked and
the same palette is laid over it.

## Deviations from the reference

* The reference decodes JPEG and composites; this port does neither, as above.
* A run that reaches past the file, a version below nothing, a picture of no size, and an alpha run whose
  marks are not ones the engine writes are all refused. The reference reads through the end of its own view
  in places.
* Every read is bounded to the file.

## Verification

Seven tests: the head read back field by field; the key, checked byte by byte against the key the engine
fixes - both for a run longer than it, where the bytes behind it must stand as they are, and for a run
shorter than it, which is keyed through its whole length; the alpha run unpacked for each of its five marks
at once, with one byte of the fixture whose palette colour is not itself, so the grey of that colour comes
out rather than the index; both entries listed and extracted, the picture byte for byte and the alpha run as
a bitmap of the size and the greys expected; the refusals; and the word of the picture.

What stands on the reference alone: the JPEG itself is never decoded here, so nothing checks that the run is
a picture at all, and no real picture is on hand to compare against GARbro's output.
