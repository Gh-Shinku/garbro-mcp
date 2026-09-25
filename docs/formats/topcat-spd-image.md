# TopCat compressed image (SPD)

* Reference: `ArcFormats/TopCat/ImageSPD.cs` (classes `SpdFormat`, `SpdMetaData` and the `SpdReader`
  beside them), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `topcat-spd-image`; tag `SPD`; extension `.spd`.

## Head

The picture opens with the mark of the walk of it (`SPDC`, `SPD8` or `SPD7`), of four places of the file,
and with the places of the file of five words. The reference holds the places of a colour of a place of the
picture and the walk of the places of it in the second word, the width in the third, the height in the
fourth and the count of the places of the picture of the walk in the fifth; the three first of them stand of
the places of the file of the fifth taken off them, of the places of the file of the walk of the engine
itself (`dw[3] -= (dw[4] >> 2) & 0xF731`, `dw[2] -= (dw[4] << 2) & 0x137F`, `dw[1] -= (dw[4] << 4) &
0xFFFF`). The last place of the mark stands of the places of the file of a picture of a walk of the places
of the picture itself ('7' or '8', of no places of the file of the table of the colours of it).

## The walks of the places of the picture

The walk of the places of the file (`UnpackLz`) stands at 0x14 of the file: a place of a control byte each,
of the lowest place of the byte first: a place standing of one stands of one place of the file, and a place
standing of nought of a run of the places of the picture the places of the file behind the control name (of
`3 + (low & 0xF)` places of the picture, of the places of the file of the count of the run of them: the high
nibble of the place of the file first, then the low one).

| the walk of the places of the file | what the places of the picture stand of |
| --- | --- |
| `SPDC` | the walk of the places of the picture itself: of the places of the file of the pixel before the place of the walk (of sixteen places of the file of the kind of the walk, of eight of the row above it, of two of the row above and to either side of it), and of the places of the file of a place of a colour of the picture where the kind of the walk of it stands above 0x1B |
| `SPD8`, `SPD7`, of the walks of the runs | of the places of the picture of the walk of the places of the file, of the runs of the places of a colour of it, of the counts of the places of the runs |
| `SPDC`, `SPD8`, `SPD7`, of the walk of the file itself | of the places of the file of the walk of the places of the file alone |

The walk of the places of a picture of the engine of the place of the file of a colour of the picture
(`UnpackSpdc`) stands of the places of the file of the walk of the engine itself, of five places of the file
of the kind of the walk and then of eight of them of the places of the file of a place of a colour of the
picture, of the places of the colour of the place of the picture before the place of the walk (of the places
of the file of the walk of the colours of the picture itself, of `DiffPrefixTable`, of `DiffLengthsTable`
and of `DiffTable`).

## What this port does not carry

* **A picture of the walk of a JPEG of the places of the file of it** (the walk 0x103). The reference stands
  of WPF for the places of the file of the JPEG; this port stands of `UNSUPPORTED_FEATURE`.
* **A picture of the places of a colour of a place of it of no walk of the engine** (of no 24 or 32 places of
  a colour to a place of the picture), and a picture of a walk of the places of the file this project does
  not know: `UNSUPPORTED_FEATURE`, as the reference stands of `NotSupportedException` and of
  `NotImplementedException`.
* **A run of the walk standing of no places of the picture before the place of it, or of more places of the
  picture than the picture holds, and a walk standing short of the file of the picture.** The first two stand
  of `INVALID_ARCHIVE` here (the reference stands of the places of the picture itself, of no guard of it);
  the walk of the file stands of the places of the picture where the file of the picture ends, as the walk of
  the reference stands of them.
* **Packing a picture.** `SpdFormat.Write` stands of no walk of it in the reference.

## How the walk stands verified

Five pictures of our own stand of the walk of the engine: the head of the picture (of the places of the file
of the words of the walk of it, of the three marks of the engine), a picture of the walk of the places of the
file (of the places of the file of the walk of the runs of the picture), a picture of the walk of the places
of the picture itself (of the places of the file of the walk of the engine), the walks this port does not
carry, and the marks of the head of the picture.

**The walks of the runs of the picture stand of no verification here.** The pictures of our own of the walks
of the runs (0, 0x100, 2 and 0x102) stand of the places of the file of the walk of the runs of the picture
behind the places of the file of the walk of the places of it: the walk of the places of the file of this
port stands of a run of the places of the picture before the places of the file of the walk of them there,
of `INVALID_ARCHIVE`, where the walk of the reference stands of the places of the picture of the file of the
picture itself. The places of the file of the walk of the runs of the engine stand readable here, and the
places of the picture of the walk of the places of the file of it (`SPDC`) stand of the places of the file
of a walk of the same reference written apart from this port, which stands of the same places of the picture
as this port of every picture of the walk of the places of the picture itself.
