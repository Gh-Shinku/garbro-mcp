# μ-GameOperationSystem compressed bitmap

Reference: `GARbro/ArcFormats/uGOS/ImageBMP.cs`, classes `DetBmpFormat` and `DetBmpFormat.Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ugos/det-image.ts` (`ugosDetBmpImageDescriptor`, `ugosDetBmpImageFormat`,
id `ugos-bmp-image`, `readDetLayout`, `decodeDetPicture`) over the walk in
`packages/formats/src/ugos/det-bmp-reader.ts` (`createDetTables`, `unpackDetPicture`). The archive of the same
engine stands in `packages/formats/src/ugos/det.ts` (`ugos-det`, from `ArcDET.cs`); the picture and the archive
are told apart by the head of the picture.

## The head

Sixteen places: the word `F`, the kind of the picture, the places a place of the picture stands in (8, `0x18` or
`0x20`), and how wide and how tall the picture stands. The kind is read with the places of the word behind it
dropped, so a head that names the kind in the places beneath it stands as one that names it above; the reference
registers the three heads it names the picture with and falls back to the head itself for the rest.

## The walk

The places of the picture stand walked rather than as they stand in the picture. Every instruction names one of a
hundred and sixty-three predictors through a list whose order changes as the picture is walked, the instructions
used drawn forward by up to four places. The predictors are:

- **A place that stands as it is written** — the places of it stand in the three words behind the instruction,
  turned about through the places behind the word, with the place behind the first word standing in the value.
- **A run of places** copied from places already walked, the places of the run standing in a word.
- **A place copied** from one place already walked.
- **A place stood from the places around it** — one of forty places standing above and beside it, named by the
  instruction, either alone or with the places around that place; a word behind the instruction names whether the
  place beside it stands from the same places as well. Nine and thirty further instructions name a place stood
  from a place above it and the place beside that one, with the difference of the place standing in three words.

A picture of thirty-two places walks the places behind its places from a stream of its own, which stands behind
the places of the picture: a word of the places that stand behind them and a count of the places it stands in. A
picture of eight places stands walked as one place for every place of it, the first of the four places the walk
stands.

## Deviations from the reference

- The reference reads and writes the places of the picture through helpers that stand the places of the picture
  within an array and throw when an instruction names a place outside it; this port refuses such an instruction
  with a `GarbroError` instead.
- A picture of no places stands nowhere and is refused; the reference would walk it as a picture of no places.
- The reference names a picture of four and twenty places as a picture of thirty-two places when it hands it out
  and stands the places behind its places as the picture stands them rather than walking them; this port stands
  them the same way.
- The instruction list is rebuilt for every picture, as the reference rebuilds it, rather than being held
  between pictures.

## Tests

`tests/formats/ugos-bmp-image.test.ts` covers the head and the kind read with the places of the word behind it
dropped, the heads it is turned away for, the walk of the places of a picture of four places by four against an
account of the reference of its own, a picture of four places, one of four and twenty places with the places
behind its places standing as the picture stands them, one of eight places standing as one place for every place
of it, a picture cut short of its places, and the words the picture is told by. What the walk stands for the
picture of the test was computed from the reference by an account of its own that refuses every place outside the
picture, so the account and the port agree on the whole of the picture rather than on a part of it.
