# Triangle compressed bitmap (IAF)

* Reference: `ArcFormats/Triangle/ImageIAF.cs` (classes `IafFormat` and the `RleReader` beside it), GARbro
  commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `triangle-iaf-image`; tag `IAF`; extension `.iaf`.

The reference registers no signature of its own. It tells the four heads of this engine apart by the length
of the file alone, and then by the bitmap behind them.

## Head

| at | what stands there |
| --- | --- |
| 0 | the length of the packed picture, a place behind the head of the first kind |
| 1 | the same, four bytes from the second place of it |
| 4 | the length of the packed picture, where it stands behind a four byte head |
| 0xc, or the tail | where the picture stands to the left and above, and the length of the bitmap behind the places |

The four heads, told by the length of the file, are:

| the length | the head | the packed places | the tail |
| --- | --- | --- | --- |
| `5 + packed + 0x14` | 5 bytes | from 5 | 0x14 bytes, the length of the bitmap at 0x10 |
| `5 + packed + 0xc` | 5 bytes | from 5 | 0xc bytes, the length of the bitmap at 8 |
| `4 + packed + 0xc` | 4 bytes | from 4 | 0xc bytes, the length of the bitmap at 8 |
| anything else | 12 bytes, the places of the picture at 0, 4 | from 12 | the whole rest of the file |

The places of the picture stand no further than 4096 from its corner. The length of the bitmap stands with
the two highest places of it naming the kind of packing the places stand of, and a kind of three is turned
away. The bitmap behind the places opens with `BM`, or with `CM` where its places stand of one colour at a
time.

## The kinds of packing

| kind | what the packed places stand of |
| --- | --- |
| 0 | the walks of the engine's own LZSS (frame 0x1000, filled with nothing, from 0xFEE) |
| 1 | the places as they stand |
| 2 | the runs of the engine's own reader |

The runs stand of two kinds, which the word in front of them tells apart. The word `0x014D4142` - the places
`BAM\x01` - stands in front of the runs of the second kind, which name one place and how many of it stand;
every other picture stands of the runs of the first kind, which stand of a control place in front of every
run: nothing in it names how many places stand as they are behind it, and a place in it names how many places
the place behind it stands of.

A bitmap standing of one colour at a time (`CM`) is put together before it is handed over: the places of it
stand of one colour after another as it stands in the file, and they are written one place of a pixel at a
time.

## The alpha of a picture

A picture of 24 bits or more may stand with a second bitmap behind it: an eight bit bitmap whose places are
named by the places of the first, and whose places stand of the colours of its own map, of which the average
is taken. The alpha of a place of the picture stands one off that grey. Where the second bitmap names other
places than the first, or where anything of it stands of nothing, the picture is handed over without it.

## Deviations

* Every read is bounded, and a picture whose head names a length longer than the file, whose packed places
  stand short of the places it names, or whose bitmap behind them stands of no bitmap, is turned away.
* The word the kinds of runs are told by is only read where the packed places hold four of them; a picture
  standing shorter than that stands of the runs of the first kind.
* A run of the first kind whose places stand short of the packed picture walks the packed places by the
  count it was given, as the reference does, so the places behind it stand of nothing.
* The places of the bitmap are reported as the bitmap states them, a height standing of the other way up
  included, as the reference reports them.

## Verification

Six tests over synthetic fixtures (`tests/formats/triangle-iaf-image.test.ts`): the four heads of this engine
and the pictures it turns away; a picture whose bitmap stands as it stands, and the same picture standing of
the walks of the engine's own LZSS; a bitmap whose places stand of one colour at a time, put together and
handed over; the runs of both kinds, of a run naming more places than stand in the picture; the alpha of a
picture taken from the colours of its own map; and the head the format tells a picture by.

A head naming a length other than the length of the places behind it, and a run of the first kind whose
places stand short of the packed picture, stand in the port as they stand in the reference but no fixture of
them was finished; they stand among the places still to be verified of the record of this format, together
with the differential against the reference on real files.
