# Nekotaro Game System image (`GCMP`)

Format reference: GARbro `Legacy/Nekotaro/ImageGCmp.cs`, classes `GCmpFormat`, `GCmpDecoder` and the
`DefaultPalette` beside them, GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

A picture opens with the letters `GCmp`, the width (`u16` at 8), the height (`u16` at 10) and a place
of the file of the walk of the engine (`i8` at 12, of the letters `GCMP` and `AIG` of the name of the
file of it): the places of the file of a colour of a place of the picture of it stand of the *places of
the file of the value of it* (24, 8 or 1 of them alone), and the places of the file of the picture of
the engine stand of the walk of the engine where the value stands of `0` or above, of the places of the
file of the picture of the engine themselves where it stands below it. The walk of the places of the
file of the picture of the engine begins at `0x10`.

## The walk of the twenty four places of a colour of the engine

The walk stands of the frame of the walk of the engine: the `128` places of the file of the colour of
it (`384` places of the file of the picture of the engine), of the places of the file of the colour of
the walk of the engine of the places of the file of the picture of it. A place of the file of the walk
of the engine stands of the places of the file of the picture of the engine itself:

* of the places of the file of the colour of the walk of the engine at the front of the frame of it
  (the high place of the file of the walk of the engine of the place of it stands set: the count of the
  places of the picture of the walk of the engine stands of the two places of the file of the high
  places of it, of the places of the file of the frame of it of the five low places of it, of the
  places of the file of the count of the walk of the engine of `0x20` places of the file of it or above
  of the places of the file of the walk of the engine itself — of a count of the places of the picture
  of the engine of `0` of them the places of the file of the count of the walk of the engine of the
  four places of the file of the picture of the engine itself),
* of the places of the file of the picture of the engine of the walk of the engine itself (the count of
  the places of the file of the picture of it of `1` of them stands of the places of the file of the
  *chunk* of the walk of the engine: the places of the file of the picture of the walk of the engine of
  the count of the places of the file of the chunk of it behind the walk of the engine, of the places
  of the picture of the walk of the engine itself),
* of the places of the file of the colour of the walk of the engine of the places of the file of the
  picture of it of `0` of them (the places of the file of the count of the walk of the engine of the
  four places of the file of the picture of the engine itself), or
* of the places of the file of the picture of the engine of the walk of the engine itself, of the
  places of the file of the count of the places of the file of the picture of it.

The places of the file of the picture of the engine of the walk of the engine stand of the places of
the file of the picture of the walk of the engine itself: the places of the file of the colour of the
walk of the engine themselves. The places of the file of the frame of the walk of the engine stand of
the places of the file of the picture of the walk of the engine of the places of the file of the
picture of it: the places of the file of the colour of the walk of the engine at the front of the
frame of it.

## The walk of the eight places of a colour of the engine

The walk of the places of the file of a picture of the eight places of a colour of the engine (and of
one of them, of the places of the file of a row of the picture of the engine of the places of the file
of the eight of them) stands of the frame of the walk of the engine of the fifteen places of the file
of it (the places `0` to `13` of the picture of the engine and the places of the file of the colour of
the walk of the engine of `0xFF`). A place of the file of the walk of the engine stands of the places
of the file of the picture of the engine itself of the two places of the file of the walk of the engine
of the place of it: the high places of it of the places of the file of the colour of the walk of the
engine at the front of the frame of it (of the count of the places of the picture of the walk of the
engine of the low places of it), of no places of the file of them of the places of the file of the
count of the walk of the engine of the low places of it (of `10` of them the places of the file of the
count of the walk of the engine of the place of the file of the picture of it behind the walk of the
engine, of `11` of them of the two places of the file of it of `267` places of the file of the picture
of the engine added to them, of `12` of them of the four places of the file of it of `65803` places of
the file of the picture of the engine added to them, and of `13`, `14` and `15` of them the places of
the file of the count of the places of the file of the picture of the walk of the engine of the places
of the file of the picture of the engine itself of the places of the file of the count of the walk of
the engine of `0x10`, `0x120` and `0x10130` of them) and of the places of the file of the picture of
the engine of the walk of the engine itself (the places of the file of the colour of the walk of the
engine of the places of the file of the frame of it of the high places of the file of the place of the
file of the picture of it, of the places of the file of the count of the walk of the engine of the four
places of the file of the table of the engine itself of the three forms of it).

Where the places of the file of the walk of the engine of the places of the file of the picture of the
engine stand of no places of the file of it, the places of the file of the picture of the engine stand
of the places of the file of the picture of the engine themselves (`IsCompressed` of no places of the
file of it).

## The table of the colours of the engine

The walk of the eight places of a colour of the engine stands of the places of the file of the table of
the colours of the engine itself: the reference reads the `SYSTEM.LZS` of the places of the file of the
engine at the side of the picture of it (`RetrievePalette`), of the places of the file of the name of
the picture of the engine of it, of the places of the file of the NSC archive of it, and stands of the
`DefaultPalette` of the places of the file of the engine itself of no places of the file of it. This
port stands of the `DefaultPalette` alone: the places of the file of the engine of the picture of the
engine itself stand of the places of the file of the picture of the engine of the walk of the engine of
the file of it, of no places of the file of the walk of the engine of the game.

## Where this port stands of the walk of the places of the file of the engine

The places of the file of the walk of the engine outside the places of the file of the picture of the
engine, of the places of the file of the frame of the walk of the engine outside the frame of it, of
the places of the file of the count of the walk of the engine of no places of the file of it, and of
the places of the file of the picture of no places of the file of the picture of the engine itself
stand of `INVALID_ARCHIVE` here; the reference stands of the places of the file of the walk of the
engine outside the places of the file of the picture of it of the places of the file of the engine
itself.

## How the walk stands verified

Ten walks of our own: the head of the picture of the engine (of the three kinds of the places of the
file of a colour of a place of the picture of it, of the places of the file of the walk of the engine
of the places of the file of the picture of the engine itself and of a head of no places of the file of
it), the walks of the places of the file of the picture of the engine of the two kinds of the walk of
it (of the places of the file of a colour of the walk of the engine, of the frame of it, of the chunk
of it, of the places of the file of the count of the walk of the engine of the three kinds of the
picture of it), and the walk of the places of the file of the picture of the engine of the walk of the
BMP of it.

The reference stands of no walk of the places of the file of a picture of the engine, so the pictures
of the test of this port stand of a walk of the places of the file of the engine written for them. The
places of the file of the picture of the engine of the walk of this port and of a walk of the same
reference written apart from it stand of the same places of the file of the picture of the engine
itself: the places of the file of the colour of the walk of the engine and of the frame of it, of the
places of the file of the chunk of the walk of the engine, of the places of the file of the count of
the walk of the engine of the three kinds of it (of the places of the file of the picture of the
engine of 49 places of the file of the count of the frame of the walk of the engine of the two of them
and of the places of the file of the 15 places of the file of the picture of it behind the walk of the
engine), and of the places of the file of the engine of the places of the file of the picture of it of
no places of the file of the walk of it.
