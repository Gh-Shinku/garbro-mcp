# Mink compressed bitmap of the second kind (BMP/FD)

* Reference: `Legacy/Mink/ImageFD.cs` (classes `FdFormat` and the `FdReader` beside it), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `mink-fd-image`; tag `BMP/FD`; extension `.fd`.

## Head

The picture opens with sixteen bytes: `F`, then `D` of either case, then the places of a place of the
picture (24 or 32), then a flag of no more than one, then the places of the picture as two words, and then
four bytes the reference reads and does not name. The reference registers three heads as its signatures -
`Fd 18 00`, `FD 18 00` and `Fd 20 00` - and a fourth standing of no bits, which this port does not register,
because a head naming no bits stands of every file; the extension carries it instead. The walk of the places
of the picture begins at the place behind the head.

The flag stands of the head of the picture and of nothing in the walk of the places of it: the reader of
this engine reads it into the places of the picture and never looks at it again.

## The numbers of the controls

The reference keeps two tables the walk of the places of a picture stands on, and both of them stand of the
**static constructor of the reader** rather than of a list in the source: the numbers of the controls (of
the walk of the places of the file, whose last number is its own) and the five walks of the numbers of a
byte. This port writes both of them the same way - the same loops over the same places, with a byte held as
a place of eight bits whose top bit is its sign, as the reference holds it - so the tables are built rather
than copied.

A control is read by `ReadNext`: the place of the last byte read names a run of the places of it, which the
reference takes from the tables above, and where the run stands behind the number of the places the value
already holds, the byte behind it stands of the places of the number and of a place set at the bottom of it.

## The places of the colours

Every pass over the places of the picture reads one control and stands on the number it names:

| the number of the control | what the place stands of |
| --- | --- |
| 0, 1 | the three bytes behind the control, each of them named by a walk of its own and one of them the place of the walk itself |
| 2 to 19 | the place one of the eighteen places before the place stands of, each colour of it taking a run of its own from the bits |
| 20 to 37 | a run of the places of the picture, taken from a place one of the same eighteen places off, the run standing either of the places themselves or of the difference of the place and the place behind it |
| 38 | a run of the places of the picture, taken as they stand |

The eighteen places stand of two lists in the reference, one for the places to either side and one for the
places above and below; both are written out here as they stand there.

## The places of the alpha

A picture of four places to a pixel takes a second pass over its places, which reads a run of the places of
the picture at a time: the place of the last byte read names the alpha itself, and the number behind it
names the run the alpha stands over, the alpha standing in the highest of the four places of a pixel.

## The bitmap handed over

The reference hands the places of the picture over as `CreateFlipped` with four bytes to a pixel and the
alpha standing highest, so the rows of the bitmap stand from the bottom of the picture up. This port writes
the same bitmap, the places of a pixel standing blue, green, red and then the alpha.

## What this port does not carry

* The walk of a picture whose places stand past the file, or a control naming a number outside the table of
  the controls, or a run standing past the places of the picture, ends as `INVALID_ARCHIVE` here. The
  reference reads past the end of a short file and reads places outside the places of a picture with
  nothing standing in its way.
* `FdFormat.Write` stands of no walk at all in the reference (`throw new System.NotImplementedException`),
  so no picture of this kind is written here either.

## How the walk stands verified

The four walks of the places of a picture (a place of its own, a place behind the place before it, a run of
the places of the picture, and a run of them as the difference of the places) stand of four pictures of two
places, of which the last three stand of the run behind them. The walks of those pictures and the places
they hand over came from an **independent walk of the same reference**, written apart from this port in
another language, and the two agree over every place of them; the places of the picture then stand of the
bitmap the reference hands over, read back from the top row down.

One picture of a single place stands of a walk worked out by hand: its control stands of a place of the
three bytes behind it, of which the last names the lowest place of the pixel, and the number of the place
standing lowest of the run is what the place itself stands of. That walk hands over a white pixel, of
`r = 2`, `g = 2` and `b = 3` behind the control, where the two first stand of no change to the place and
the last stands of `(1 ^ -1) >> 1`, which is `-1`.
