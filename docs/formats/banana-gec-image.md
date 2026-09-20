# Yellow Pig image format (`GEC`)

Reference: GARbro `ArcFormats/Banana/ImageGEC.cs`, classes `GecFormat`, `GecMetaData` and `GecReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A picture of the engine of the yellow pig: the places of the picture standing of the places of the picture of
the walk of the places of them of the picture of the words of the head of the picture, of the places of the
picture of the walk of the places of the picture of the places of the picture of their own, of the places of
the picture of the walk of the places of the picture of a picture of the words of the head of the picture of
the pictures of the engine, and of the places of the picture of the walk of the places of the picture of the
places of the picture of their own again.

## Head

| place | word |
| --- | --- |
| 0 | the kind of the walk of the places of the picture (0 or 1) |
| 1 | the places of the picture of the walk of the places of the picture before the picture (i16) |
| 3 | the places of the picture of the walk of the places of the picture of the picture (i16) |
| 5 | how wide the picture stands (u16) |
| 7 | how tall the picture stands (u16) |
| 9 | the places of the picture of the walk of the places of the picture of the picture of the walk of them |
| 0xD | the places of the picture of the walk of the places of the picture of the picture of the places of their own |

A picture of the kind of the walk of the places of the picture of the first kind stands of the places of the
picture of three places of the picture of a place of the picture; a picture of the kind of the walk of the
places of the picture of the second kind stands of the places of the picture of four, of the places of the
picture of the walk of the places of the picture of the picture of the walk of them of the places of the
picture of their own. A picture of the second kind stands the words of the head of the picture of the places
of the picture of the walk of them behind the words of the head of the picture of the places of the picture of
the walk of the places of the picture of the picture of the walk of the places of them:

| place | word |
| --- | --- |
| 0x15 | how wide the places of the picture of the walk of the places of the picture of the picture of the places of the picture stand |
| 0x17 | how tall they stand |
| 0x19 | the places of the picture of the walk of the places of the picture of the picture of the places of the picture of the walk of them |

## The walk of the places of the picture

The places of the picture of the walk of the places of the picture stand of the places of the picture of the
words of the walk of the picture: a word of the walk of the places of the picture stands for two and thirty
places of the picture, the places of the picture of the walk of the places of the picture of the place of the
picture of the walk of them standing of the places of the picture of the walk of them of the places of the
picture of the walk of the places of the picture of the places of the picture of their own, and the places of
the picture of the walk of the places of the picture standing of the places of the picture of the walk of them
of the places of the picture of the walk of the places of the picture of the place of the picture of the walk
of them.

`GetInt` stands the places of the picture of the walk of the places of the picture of a picture of the places
of the picture of the walk of the places of the picture of their own: the places of the picture of the walk
of the places of the picture of the picture stand as the places of the picture of the walk of them of the
places of the picture of the picture of the walk of them, the places of the picture of the walk of them of
the places of the picture of the walk of the places of the picture of the picture of the places of the
picture of the walk of them standing behind the places of the picture of the walk of them.

Every place of the walk of the places of the picture stands for the places of the picture of a picture of the
words of the walk of the picture of their own, or for a picture of the places of the picture of the walk of
the places of the picture of the places of the picture of their own:

* the places of the picture of the walk of the places of the picture of the picture of the words of the walk
  of them stand of the places of the picture of the walk of the places of the picture, the places of the
  picture of the walk of the places of the picture of the picture of the walk of them standing as the places
  of the picture of no places of their own where the places of the walk of the picture stand for them, and as
  the places of the picture of the walk of the places of the picture of a picture of their own where the
  places of the walk of the picture stand for the places of the picture of the walk of them;
* the places of the picture of the walk of the places of the picture of the picture of their own stand beside
  each other, the places of the picture of the walk of the places of the picture of the walk of them standing
  of the places of the picture of the walk of the places of the picture of the picture of the walk of them —
  and the places of the picture of the runs of them standing of the places of the picture of the walk of the
  places of the picture of the walk of them of the places of the picture of the walk of the places of the
  picture of the picture of the walk of them;
* the places of the picture of the walk of the places of the picture of the picture of the words of the walk
  of the picture stand as the places of the picture of the walk of the places of the picture of the place of
  the picture of the walk of them, the places of the picture of the walk of the places of the picture of the
  picture of their own standing of the places of the picture of the walk of the places of the picture of the
  places of the picture of the walk of them;
* the places of the picture of the walk of the places of the picture of the picture of the walk of them stand
  as the places of the picture of the walk of the places of the picture of the picture of the walk of the
  places of the picture of the words of the head of the picture, the places of the picture of the walk of the
  places of the picture of the picture standing as the places of the picture of the walk of the places of the
  picture of the place of the picture of the walk of them of the places of the picture of the picture.

The places of the picture of the walk of the places of the picture of the second kind stand beside the places
of the picture of the walk of the places of the picture of the picture of the places of the picture of the
walk of them, the places of the picture of the walk of the places of the picture of the picture of the walk
of them standing of the places of the picture of the walk of the places of the picture of the picture of
their own.

## Deviations from the reference

The walk stands as the reference stands it, with three differences, all of them where the reference reads or
writes beyond the places of the picture it names:

* the runs of the places of the picture of no places of their own of `ReadFrame` stand short of the places of
  the picture of the walk of the places of the picture where the run stands for more places than the picture
  of the walk of the places of the picture stands for — the reference stands the places of the picture of the
  walk of them beyond the places of the picture of the walk of the places of the picture of the walk of them;
* the places of the picture of the walk of the places of the picture of the picture of the walk of them stand
  as the places of the picture of the walk of the places of the picture of the walk of them where the run
  stands past the places of the picture of the walk of the places of the picture of the picture of the walk of
  them;
* a picture of the places of the picture of the walk of the places of the picture of the walk of the places of
  the picture of the picture that stands short of the places of the picture of the walk of them turns a
  picture of this project away, where the reference stands the places of the picture of the walk of the places
  of the picture beyond the places of the picture of the walk of them.

The reference stands the places of the picture of the walk of the places of the picture of the picture of the
places of the picture of the walk of them, which a picture of this project stands of the places of the
picture of the walk of the places of the picture of the picture of the walk of them of the picture of the
places of the picture of the walk of the places of the picture of the places of the picture of their own.

## Verification

Twelve fixtures of synthetic pictures stand against the walk of the words of the head of the picture and the
places of the picture of the walk of the places of the picture: the words of the head of the picture of the
kinds of the walk of the places of the picture of the first and the second kind and the places of the picture
of the walk of the places of the picture of the picture of the walk of them; the words of the head of a
picture that stand for no picture of this kind; the places of the picture of the walk of the places of the
picture of the picture of the words of the walk of the picture of the runs of them; the places of the picture
of the walk of the places of the picture of a picture of the word of their own, and of a picture of the
places of the picture of the picture of the walk of them; the places of the picture of the walk of the
places of the picture of the picture of the picture of the walk of them, of the picture of the walk of the
places of the picture of the picture of the walk of the places of the picture of the picture of their own,
and of the picture of the walk of the places of the picture of the runs of them; the places of the picture of
the walk of the places of the picture of the picture of the places of the picture of the walk of them
standing beside the places of the picture of the walk of the places of the picture of the picture of the
words of the walk of them; the places of the picture of the walk of the places of the picture stood out as
the places of the picture of the words of the walk of the picture; and a picture of the places of the
picture of the walk of them that stand short of the places of the picture of the walk of them.

Two of the fixtures stand the places of the picture of the walk of the places of the picture of the picture
of the words of the walk of the picture of the places of the picture of their own against a picture of the
places of the picture of the walk of the places of the picture of the tables of the walk of the places of the
picture: an independent transcription of `GecReader.UnpackFrame1` and `GecReader.UnpackFrame2` in Python,
so the places of the picture of the walk of the places of the picture of the walk of them stand of the places
of the picture of the walk of the places of the picture of a picture of their own.

The places of the picture of the walk of the places of the picture of the words of the walk of the picture of
the picture of the places of the picture of the walk of them stand of the places of the picture of the walk of
the places of the picture of a picture of the words of the walk of the picture of their own, so the places of
the picture of the walk of the places of the picture of the picture of the places of the picture of the walk
of them stand of the places of the picture of the walk of the places of the picture of the picture of the
places of the picture of the walk of them.
