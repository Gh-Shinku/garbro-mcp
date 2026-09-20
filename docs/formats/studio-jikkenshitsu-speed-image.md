# Studio Jikkenshitsu picture of the kind its own files stand as

Reference: `GARbro/ArcFormats/StudioJikkenshitsu/ImageDAT.cs`, classes `SpDatFormat` and `SpReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/studio-jikkenshitsu/speed-image.ts`
(`studioJikkenshitsuSpeedImageDescriptor`, `studioJikkenshitsuSpeedImageFormat`, id
`studio-jikkenshitsu-speed-image`, `readSpeedLayout`, `unpackSpeedRuns`, `decodeSpeed`, `composeSpeed`), with
the bitmap writers of `packages/formats/src/shared/bmp.ts`.

The reference registers no word of its own but the three places of the head of its own, and no name; it stands
among the kinds that are offered every file.

## The head

The word behind the head stands at nought, the place at `0x02` stands at one, the places of a colour of the
picture stand in the places at `0x00` — every place behind the first, which only the head itself uses, holding
nothing — the width of the picture stands in the words at `0x16`, its height in the words at `0x18`, and how
many colours stand beside it in the words at `0x1E`. A picture stands at most `0x2000` places along either
side and names at most `0x100` colours.

The place that counts eight places of a colour names whether the places of the picture stand under the standard
cipher. The key of such a picture stands in the reference's own settings, which name a key for every title it
knows, and this project carries no such settings; a picture whose places stand under the cipher is therefore
not read here, which is what the reference does where it finds no key.

## The walks of the places

The places of the picture stand behind the head and the places of its shape behind those, and each of the two
stands behind a walk of its own. Where the head names no walk of the places — the word that counts them
standing at nought — the places stand as they stand; otherwise they stand behind a walk of runs:

| the places of the walk | what stands |
| ---------------------- | ----------- |
| a place | a place of the picture, as it stands |
| a place that stands as the place behind it | that place again, and the place behind it in the walk names how many places stand the same way, counting the two that stand before it |
| any other place | a place of the picture, as it stands |

The places of a shape stand two to a byte, the highest places of a byte standing for the place of the picture
that stands first, and every place of a shape stands as many places of a colour of its own as name it, four
places of a colour of the picture and twenty four standing for every one of them.

## Deviations from the reference

- A file of fewer than four and thirty places, a file whose word behind the head does not stand at nought, a
  file whose place at `0x02` does not stand at one, a file whose places of a colour stand wider than a place,
  a picture of no places or of more places than the reference holds, and a picture whose places stand under a
  key of their own are turned away; the reference would throw or leave the picture to another kind.
- A picture that names no colours of its own stands as a picture of four places of a colour in the reference,
  which this project does not read; such a picture is refused with a message.
- A run that names more places than the picture holds, and a walk that stands short of the places of the
  picture, are refused with a message, where the reference reads past the places of its own stream.

## Tests

`tests/formats/studio-jikkenshitsu-speed-image.test.ts` covers the head and the words it is turned away for, a
picture of places beyond what a picture holds, a picture whose places stand under a key of its own, the runs a
walk of runs names, a picture whose places stand as they stand, a picture whose places stand behind such a
walk, the shape of the places of a picture, the bitmap a picture of eight bits hands out, the places of a
shape stood in the places of a picture, and the finding of a picture of its own kind.
