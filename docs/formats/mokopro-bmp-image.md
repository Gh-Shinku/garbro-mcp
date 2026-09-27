# Mokopro compressed bitmap

Reference: `GARbro/ArcFormats/MokoPro/CompressedFile.cs`, classes `NNNNBmpFormat` and `NNNNMetaData`, with
`MokoCrypt`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/moko-pro/bmp-image.ts` (`mokoProBmpImageDescriptor`,
`mokoProBmpImageFormat`, id `mokopro-bmp-image`), with the container of the engine in
`packages/formats/src/moko-pro/moko-core.ts` (`MOKO_SIGNATURE`, `decryptMoko`, `readMokoHeader`,
`unpackMoko`) and the bitmap reader of `packages/formats/src/shared/bmp.ts`.

The reference registers the word `NNNN` and no name; the archive shape of the same container
(`mokopro-nnnn`) registers the very word, so the picture and the sound are tried ahead of the archive wherever
no name says otherwise.

## The container

The file begins with the word `NNNN` and the size of what stands behind it, and everything behind those eight
bytes is walked over backwards — every byte mixed with the byte behind it and two bytes of key — and then
walked out by a walk of runs whose ring is filled with spaces instead of noughts. What that gives is the
bitmap of the engine, as it stands, and the head of the bitmap says what the picture is.

## Deviations from the reference

- `NNNNBmpFormat.Read` stands of `Bmp.Read` over the unpacked surface: the bitmap stands read of the bitmap walk of
  this project — of the counts of its own head, of one, four, eight, sixteen, twenty four or thirty two places of a
  colour to a pixel, and of the rows in the order its head names — and handed over as a bitmap of its own. A surface
  the walk of this project cannot read stands turned away on extraction, which is where the reference would fail as
  well, and the head of the bitmap is read for the measurements of the entry.
- A file of fewer than eight bytes, a file whose word is not `NNNN`, a file whose size of the walk of runs
  stands below one or above what this project will hold, and a walk of runs that does not give a bitmap at all
  are turned away; the reference would throw while reading the head of the container or the head of the
  bitmap.

## Tests

`tests/formats/mokopro-bmp-image.test.ts` covers the unwrapping of a bitmap behind the walk of runs — with its
name, its sizes, its shapes and the picture itself — a payload that is not a bitmap, a file whose word is not
`NNNN` and a file too short to hold the head of the container.
