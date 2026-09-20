# Purple Software image format

Reference: `GARbro/ArcFormats/Cmvs/ImagePB3.cs`, classes `Pb3Format`, `PbReaderBase` and `Pb3Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cmvs/pb3-image.ts` (`cmvsPb3ImageDescriptor`, `cmvsPb3ImageFormat`, id
picture of the Purple engine that `jbp-reader.ts` and `jbp-coefficients.ts` stand.

## The head

The reference registers the words `PB3B` and reads the words of the head of a picture behind them: how many
stands, and how many places a place of it stands in. The words at `0x2C` and `0x30` name where the tables of

| -------- | ------------------------- |
| one | stand as a walk of their own under the tables of the picture, of the underkind `0x10` |
| five | stand as a walk of their own, every place of the walk standing beside the place before it |
| four and seven | stand as no picture the reference reads at all |

hand their places to `jbp-reader.ts`, the words of the head of such a picture standing at `0x34` and the places
own.

## Deviations from the reference

  every kind it reads.
- A picture of no places, of more than two hundred and fifty six million places, of a number of places a place
  of it stands in other than four and twenty or two and thirty, of a kind the reference does not read, and whose
  reading those.
  picture names two and thirty places a place and of three colours a place where it names four and twenty, which

## The walks this port does not stand

- The places of a picture of the kinds four and seven stand as no picture the reference reads at all.

## The picture the words of a picture name

ever.

pictures of the other kinds; a picture whose words name a picture of another kind stands as no picture of this
