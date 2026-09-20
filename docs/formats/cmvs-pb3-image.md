# Purple Software image format

Reference: `GARbro/ArcFormats/Cmvs/ImagePB3.cs`, classes `Pb3Format`, `PbReaderBase` and `Pb3Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cmvs/pb3-image.ts` (`cmvsPb3ImageDescriptor`, `cmvsPb3ImageFormat`, id
`cmvs-pb3-image`), over `packages/codecs/src/pb3-reader.ts`, which stands over the walks of the places of a
picture of the Purple engine that `jbp-reader.ts` and `jbp-coefficients.ts` stand.

## The head

The reference registers the words `PB3B` and reads the words of the head of a picture behind them: how many
places of the file the picture stands in, the kind and the underkind of the picture, how wide and how tall it
stands, and how many places a place of it stands in. The words at `0x2C` and `0x30` name where the tables of
the walks of the places of the colours of the picture stand.

## The kinds of the walk of the places of a picture

| the kind | the places of the picture |
| -------- | ------------------------- |
| one | stand as a walk of their own under the tables of the picture, of the underkind `0x10` |
| two and three | stand as the places of a picture of the Purple engine that stands within them |
| five | stand as a walk of their own, every place of the walk standing beside the place before it |
| six and eight | stand as a walk of their own behind the words of the engine and the places of the game |
| four and seven | stand as no picture the reference reads at all |

This port stands the places of a picture of the kinds one, two, three and five: the places of a picture of the
second and third kinds stand as the places of a picture of the Purple engine within them and hand their places
to `jbp-reader.ts`, the words of the head of such a picture standing at `0x34` and the places of the
transparency of the picture at the place its head names; the places of a picture of the first and fifth kinds
stand as walks of their own under the tables of the picture.

## Deviations from the reference

- The reference reads the places of the file of a picture of the kinds two and three in the places of the whole
  file and the places its own head names for the other kinds; this port reads the places of the whole file for
  every kind it reads.
- A picture of no places, of more than two hundred and fifty six million places, of a number of places a place
  of it stands in other than four and twenty or two and thirty, of a kind the reference does not read, and whose
  places stand short of the walk of the places of the picture is turned away; the reference would throw while
  reading those.
- The places of the picture stand as the places of a bitmap of four colours a place where the head of the
  picture names two and thirty places a place and of three colours a place where it names four and twenty, which
  is what the reference names the places of a picture of this kind as.

## The walks this port does not stand

- The walks of the places of the kinds that stand behind the words of the engine and the places of a picture of
  the game that stand beside them stand as no part of this port.
- The places of a picture of the kinds four and seven stand as no picture the reference reads at all.

## Tests

`tests/formats/cmvs-pb3-image.test.ts` covers the head of a picture, the heads it is turned away for, the
places of a picture of the second kind stood as the places of the picture within it, the kinds this port does
not read, and the words of the picture. The picture of the second kind of the test stands as the picture of the
Purple engine of the tests of `sviu-jbp-image.test.ts`, so its places stand under a walk this port did not
work out.
