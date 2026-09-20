# Valkyria image format

Reference: `GARbro/ArcFormats/Valkyria/ImageMG2.cs`, classes `Mg2Format`, `Mg2EncryptedStream`,
`Mg2SchemeV1` and `Mg2SchemeV2`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/valkyria/mg2-image.ts` (`valkyriaMg2ImageDescriptor`,
`valkyriaMg2ImageFormat`, id `valkyria-mg2-image`, `readMg2Layout`, `unmaskMg2`, `readMg2Payload`,
`extractMg2`), with the header readers of `packages/formats/src/shared/png.ts` and
`packages/formats/src/shared/jpeg.ts`.

The reference registers the word `MICO` and the name `mg2`.

## The head

The word `MICO` stands at the beginning of the file with the word `CG01` behind it. The word at `0x08` names
how many bytes the places of the picture stand in, and the word at `0x0C` how many bytes the shape of those
places stands in.

## The mask the places stand under

The places of the picture stand behind the head and the shape of them behind those places, and the first
places of either stand under a mask that walks one place at a time from the mask of the region, every place
behind the last masked place standing as it stands. How many places stand under the mask and which mask they
stand under is told by the way the reference knows:

| the way | how many places stand under the mask | the mask of the first place |
| ------- | ------------------------------------ | --------------------------- |
| the first | a fifth of the region, whole places counting | nought |
| the second | as many places as name the region, up to twenty five | the lowest place of the region's own length |

## The places of the picture

The places of the picture stand as a portable network graphic or as a JPEG, and which of the two ways they
stand under the mask is told by the first of the two the words of the file agree with: the reference tells a
portable network graphic by the first four places of its own word and a JPEG by the word the start of the
picture and the first of its tables make up. The width, the height and the places of a colour then stand in
the header of a picture of that kind.

## The shape of the places

Where the shape of the places stands in the file, the reference gathers it out of a picture of its own, stands
it in one place of every colour and hands out a picture of thirty two bits. This project does not read a shape
of its own; a picture that carries one is refused with a message, and a picture of the second way, which the
reference stands bottom up, is handed out as it stands.

## Deviations from the reference

- A file of fewer than sixteen bytes, a file that does not hold the word of the format or the word behind it, a
  file whose head names no places or more places than stand in it, and a picture of more places than this
  project will hold are turned away; the reference would throw or read beyond its own stream.
- A picture whose places are neither a portable network graphic nor a JPEG is refused with a message, where the
  reference would hand out no picture at all.
- The places of the picture are handed out as they stand rather than read into a picture of their own, so a
  picture of the second way stands as it stands in the file rather than bottom up as the reference's own frame
  does. The shape of the places is not read at all.

## Tests

`tests/formats/valkyria-mg2-image.test.ts` covers the head and the words it is turned away for, a file whose
places stand outside it, the mask of both ways place by place, the places of a picture that stand as a
portable network graphic under either way, the places of a picture that stand as a JPEG, the places that are
neither, the picture handed out as it stands, the refusal of a picture that carries a shape of its own, and the
finding of a picture of its own kind.
