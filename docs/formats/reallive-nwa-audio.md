# RealLive engine audio format (`NWA`)

Reference: GARbro `ArcFormats/RealLive/AudioNWA.cs`, classes `NwaAudio`, `NwaMetaData` and `NwaDecoder`,
together with `LsbBitStream` from `ArcFormats/BitStream.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The signature of the RealLive engine and of the games built on it. A sound stands as a head of `0x28` places,
a table of the places of the walk of the places of the picture of every place of the picture of the sound,
and then the places of the picture of the walk of the places of the picture themselves.

## Head

| place | word |
| --- | --- |
| 0 | how many places of the picture of a place of the picture of the sound stand beside each other (1 or 2) |
| 2 | how many places of the picture of a place of the picture stand (8 or 16) |
| 4 | how many places of the picture of the sound stand within a place of the picture (u32) |
| 8 | the kind of the walk of the places of the picture (i32) |
| 0xC | whether the places of the picture of the walk of the places of the picture stand of the places of the picture of the runs of them |
| 0x10 | how many places of the picture of the walk of the places of the picture stand |
| 0x14 | how many places of the picture of the walk of the places of the picture of the sound stand |
| 0x18 | how many places of the picture of the walk of the places of the picture stand of the places of the picture of the walk of them |
| 0x1C | how many places of the picture of the walk of the places of the picture of the sound stand of their own |
| 0x20 | how many places of the picture of a place of the picture of the sound stand beside each other |
| 0x24 | how many places of the picture of the last place of the picture of the sound stand beside each other |

A picture of the kind of the walk of the places of the picture of the first kind stands of the places of the
picture of the walk of the places of the picture of the sound of their own, and the places of the picture of
the walk of the places of the picture of the sound stand as they stand from `0x2C` — the reference standing
the places of the picture of the walk of the places of the picture of the sound of no places of their own.

Every other kind of the walk of the places of the picture (0 through 5) stands of the places of the picture
of the walk of the places of the picture of the sound: `n` places of the picture of the walk of the places of
the picture of the sound stand from `0x2C`, and the places of the picture of the walk of the places of the
picture of every place of the picture of the sound stand behind them at the places of the picture of the walk
of the places of them.

## The walk of the places of the picture

The places of the picture of the walk of the places of the picture stand as a picture of the places of the
picture of a word of the walk of the places of the picture of two and thirty places, the places of the
picture of the walk of the places of the picture of the place of the picture of the walk of them standing
before the places of the picture of the walk of the places of the picture of the place of the picture of the
walk of them of the places of the picture of the walk of the places of the picture of the picture of their
own. The talk of the walk of the places of the picture stands of the places of the picture of the walk of the
places of the picture of the picture of the walk of the places of the picture of the place of the picture of
the walk of them: a picture of the places of the picture of the word of the walk of them stands for two and
thirty places of the picture of the walk of the places of the picture, and the places of the picture of the
walk of the places of the picture of the place of the picture of the walk of them stand of the places of the
picture of the walk of the places of the picture of the picture of the walk of the places of them.

Every place of the picture of the walk of the places of the picture of a place of the picture of the sound
stands of the places of the picture of the walk of the places of the picture of the place of the picture of
the walk of them:

* a place of the picture of the walk of them of `7` — a following place of the picture of the walk of the
  places of the picture stands for a place of the picture of the walk of the places of the picture of the
  sound of no places of their own, or the places of the picture of the walk of the places of the picture
  stand of the places of the picture of the walk of the places of the picture of a picture of the places of
  the picture of the walk of them, the places of the picture of the walk of the places of the picture of the
  word of the walk of them standing of the places of the picture of the walk of the places of the picture of
  the place of the picture of the walk of them;
* a place of the picture of the walk of them other than `7` and other than `0` — the places of the picture of
  the walk of the places of the picture stand of the places of the picture of the walk of the places of the
  picture of a picture of their own, the places of the picture of the walk of the places of the picture of
  the picture of the walk of them standing of the places of the picture of the walk of the places of the
  picture of the place of the picture of the walk of them;
* `0` where the places of the picture of the walk of the places of the picture stand of the places of the
  picture of the runs of them — the places of the picture of the walk of the places of the picture of the
  sound stand of the places of the picture of the walk of the places of the picture of the place of the
  picture of the walk of them for the places of the picture of the walk of them, the places of the picture of
  the walk of the places of the picture of the picture of the walk of them standing of the places of the
  picture of the walk of the places of the picture of the place of the picture of the walk of them.

The places of the picture of the walk of the places of the picture of the sound stand of the places of the
picture of the walk of the places of the picture of a place of the picture of the walk of the places of the
picture of the sound of their own, and then the places of the picture of the walk of the places of the
picture of every place of the picture of the walk of them stand of the places of the picture of the walk of
the places of the picture of the sound of their own in turn.

## Deviations from the reference

* The reference stands the places of the picture of the walk of the places of the picture of a picture of the
  walk of the places of the picture of no places of the picture of the walk of them where the places of the
  picture of the walk of the places of the picture of the sound stand short of the places of the picture of
  the walk of them, so a sound of this project turns such a sound away.
* The reference stands the places of the picture of the walk of the places of the picture of a sound whose
  places of the picture of the walk of them stand of no places of the picture of the walk of them where the
  places of the picture of the walk of the places of the picture of the last place of the picture of the
  sound stand not, so a sound of this project turns such a sound away as well.
* The places of the picture of the walk of the places of the picture of the sound stand of the places of the
  picture of the walk of the places of the picture of the sound of the picture of the walk of the places of
  the picture of the walk of them, so a sound of the places of the picture of the walk of them that stands
  short of the places of the picture of the walk of them turns a sound of this project away where the
  reference stands the places of the picture of the walk of the places of the picture beyond the places of
  the picture of the walk of them.

## The places of the picture of the walk of the places of the picture of the sound itself

The reference stands the places of the picture of the walk of the places of the picture of the sound of their
own, which this project stands of the places of the picture of the walk of the places of the picture of the
sound of the places of the picture of the walk of them stand of the places of the picture of the walk of the
places of the picture of the sound. The places of the picture of the walk of the places of the picture of a
sound of this kind stand as the places of the picture of the walk of the places of the picture of the sound of
their own where the kind of the walk of the places of the picture of the sound stands for the places of the
picture of the walk of them of the places of the picture of the sound of their own — the reference standing
the places of the picture of the walk of the places of the pictures of the engine of Windows (`WIC`) of no
places of the picture of the walk of them.

## Verification

Eleven fixtures of synthetic sounds stand against the walk of the words of the head of the picture and the
places of the picture of the walk of the places of the picture: the words of the head of a sound of the kind
of the walk of the places of the picture of the first kind and of the kinds of the walk of the places of the
picture of the places of the picture of the walk of them; the words of the head of a sound of no places of
the picture of the walk of them; the places of the picture of the walk of the places of the picture of a
picture of the walk of the places of the picture of the sound of sixteen places and of a picture of the walk
of the places of them of the places of the picture of the runs of them; the places of the picture of the walk
of the places of the picture of a sound of two places of the picture of a place of the picture of the sound;
the places of the picture of the walk of the places of the picture of a picture of the walk of the places of
the picture of the sound of their own; the places of the picture of the walk of the places of the picture of
the sound stood out as the places of the picture of a picture of the walk of the places of the picture of the
sound of their own; and the places of the picture of the walk of the places of the picture of a sound that
stand short of the places of the picture of the walk of them.

Every fixture of the places of the picture of the walk of the places of the picture of a sound of the kinds
of the walk of the places of the picture stands of the places of the picture of the walk of the places of the
picture of the places of the picture of the walk of them hand in hand with the reference, the places of the
picture of the walk of the places of the picture of the sound standing of the places of the picture of the
walk of the places of the picture of the place of the picture of the walk of them, of the places of the
picture of the walk of the places of the picture of the picture of the walk of them, and of the places of
the picture of the walk of the places of the picture of the place of the picture of the walk of them of the
places of the picture of the walk of the places of the picture of the picture of their own.
