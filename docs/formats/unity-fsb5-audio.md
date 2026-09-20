# FMOD Sample Bank audio format (`FSB5`)

Reference: GARbro `ArcFormats/Unity/AudioFSB5.cs`, classes `Fsb5Audio`, `Fsb5Decoder` and `Sample`, with the
kinds of the walk of the places of the picture of the sound `SoundFormat` and `ChunkType`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The sound banks of the engine of the places of the picture of the sound of the kind of FMOD, standing beside
the places of the picture of the walk of the places of the pictures of the engine of the kind of Unity. A
sound stands as a head, a table of the places of the picture of the walk of the places of the picture of every
place of the picture of the walk of them, a table of the names, and the places of the picture of the walk of
the places of the picture of the sound of their own.

## Head

| place | word |
| --- | --- |
| 0 | the places of the picture `FSB5` |
| 4 | the kind of the walk of the places of the picture (i32) |
| 8 | how many places of the picture of the walk of the places of the picture stand (i32) |
| 0xC | how wide the places of the picture of the walk of the places of the picture of the table of the places of the picture of the walk of them stands (i32) |
| 0x10 | how wide the places of the picture of the walk of the places of the picture of the names stands (i32) |
| 0x14 | how wide the places of the picture of the walk of the places of the picture of the sound stands (i32) |
| 0x18 | the kind of the walk of the places of the picture of the sound (i32) |

Where the kind of the walk of the places of the picture stands of no places of the picture of the walk of the
places of the picture of their own, the reference stands four places of the picture of the walk of the places
of the picture over behind the words of the head of the picture of the walk of them. The places of the picture
of the walk of the places of the picture of the sound stand then, and the places of the picture of the walk of
the places of the picture of the names, and the places of the picture of the walk of the places of the picture
of the sound of their own:

```
data_start = header_size + sample_header_size + name_table_size
```

## The places of the picture of the walk of the places of the picture of a place of the picture of the walk of them

Every place of the picture of the walk of the places of the picture of the sound stands of a word of the walk
of the places of the picture of the places of the picture of their own:

| places of the picture | word |
| --- | --- |
| 0 | whether the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture behind them stand |
| 1..4 | the places of the picture of the walk of the places of the picture of the sound of the kind of the places of the picture behind them |
| 5 | whether the places of the picture of a place of the picture of the sound stand of their own |
| 6..33 | the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them, of sixteen places of the picture each |
| 34..63 | how many places of the picture of the walk of the places of the picture of the sound stand |

The places of the picture of the walk of the places of the picture of the sound behind the words of the walk
of the places of the picture stand of a word of their own, and of the places of the picture of the walk of the
places of the picture of it:

| places of the picture | word |
| --- | --- |
| 0 | whether the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture behind them stand |
| 1..24 | how wide the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture behind them stand |
| 25..31 | the kind of the places of the picture of the walk of the places of the picture |

The kinds of the places of the picture of the walk of the places of the picture that this project stands are
`1` (the places of the picture of a place of the picture of the sound, of one place of the picture), `2` (the
places of the picture of the walk of the places of the picture of the sound within a place of the picture,
of four places of the picture), `3` (the places of the picture of the walk of them of the places of the
picture of the walk of them, of eight of their own), and `11` (the places of the picture of the walk of the
places of the picture of the sound of the kind of the places of the picture of the walk of them). Every other
kind of the places of the picture of the walk of the places of the picture stands of the places of the picture
of the walk of them of its own.

Where the places of the picture of the walk of the places of the picture of the sound of the kind of the
places of the picture behind them stand, the reference stands the places of the picture of the walk of the
places of the picture of the sound of the places of the picture of the walk of the places of the picture of
the frequency of the places of the picture behind them; where they stand not, the places of the picture of the
walk of the places of the picture of the sound of the places of the picture of the walk of the places of the
picture of the frequency of the table stand.

## The kinds of the walk of the places of the picture of the sound

The reference stands the places of the picture of the walk of the places of the picture of the sound of the
kinds `Pcm8`, `Pcm16`, `Pcm32`, `PcmFloat` and of the kind of the places of the picture of the walk of them
of the places of the picture of the walk of the places of the picture of the sound of the engine `Vorbis`
alone. The places of the picture of the walk of the places of the picture of the sound of the kinds of the
places of the picture of the walk of them of the places of the picture of the walk of the places of the
picture of the sound of the places of the picture of their own stand as the places of the picture of a sound
of the kind of the places of the picture of the walk of the places of the picture of the sound of their own:
one place of the picture of the walk of the places of the picture of four places of the picture where the
places of the picture of the walk of them stand of the places of the picture of the walk of the places of the
picture of the sound of the kind of the places of the picture of the walk of the places of the picture of the
sound of the places of the picture of their own, of two and thirty where they stand of the places of the
picture of the walk of the places of the picture of the place of the picture of the walk of them of the
places of the picture of the walk of them or of the places of the picture of the walk of the places of the
picture of the sound of sixteen places of the picture, and of eight where they stand of the places of the
picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the
places of the picture of the sound of their own.

## Deviations from the reference

* The reference stands the places of the picture of the walk of the places of the picture of the sound of the
  kind of the places of the picture of the walk of them (`Vorbis`) of the places of the picture of the walk
  of the places of the picture of the sound of the places of the picture of the walk of the places of the
  picture of their own out of a picture of the places of the picture of the walk of the places of the picture
  of the places of the picture of the picture that the reference stands out of the places of the picture of
  the walk of the places of the picture of the kind of the places of the picture of the sound of the
  engine. Those places of the picture of the walk of the places of the picture stand outside the places of
  the picture of the walk of them of the sound, so a sound of this project turns such a sound away.
* The reference stands the places of the picture of the walk of the places of the picture of the sound short
  of the places of the picture of the walk of them, and of the places of the picture of the walk of the places
  of the picture of the sound of no places of the picture of the walk of the places of the picture of the kind
  of the places of the picture behind them, as the places of the picture of the walk of the places of the
  picture of no places of the picture of the walk of them; a sound of this project turns such a sound away.
* The reference stands the places of the picture of the walk of the places of the picture of the first place
  of the picture of the walk of them alone, the places of the picture of the walk of the places of the picture
  of every other place of the picture of the walk of them standing of the places of the picture of the walk of
  the places of the picture where they stand. A picture of this project stands the same, and records how many
  places of the picture of the walk of the places of the picture stand of the picture of the walk of the
  places of the picture.

## Verification

Eleven fixtures of synthetic pictures stand against the walk of the words of the head of the picture, the
places of the picture of the walk of the places of the picture, and the places of the picture of the walk of
the places of the picture of the sound: the places of the picture of the walk of the places of the picture of
the sound of the kinds `Pcm8`, `Pcm16`, `Pcm32` and of the kind of the places of the picture of the walk of
them of the places of the picture of the walk of the places of the picture of the sound of the engine of the
places of the picture of the walk of them of the places of the picture of the walk of the places of the
picture of the sound of their own; the places of the picture of the walk of the places of the picture of the
sound of the places of the picture of the walk of the places of the picture of the frequency of the places of
the picture behind them, standing beside the places of the picture of the walk of the places of the picture of
the sound of the places of the picture of the walk of the places of the picture of the frequency of the table;
the places of the picture of the walk of the places of the picture of the sound of the kind of the places of
the picture of the walk of the places of the picture of no places of the picture of their own, where the
places of the picture of the walk of the places of the picture of the sound of the places of the picture of
the walk of them stand of the places of the picture of the walk of the places of the picture behind the words
of the head of the picture of the walk of them; the places of the picture of the walk of the places of the
picture of the sound of the places of the picture of the walk of the places of the picture of the first place
of the picture of the walk of them, where the places of the picture of the walk of the places of the picture
of the place of the picture of the walk of them behind it stand of the places of the picture of the walk of
them of a place of the picture of the walk of the places of the picture of their own; the places of the
picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the
places of the picture of no places of the picture of the walk of the places of the picture of the kind of the
places of the picture of the walk of the places of the picture of the sound of the engine of the kind of the
places of the picture of the walk of the places of the picture of the sound of the places of the picture of
the walk of the places of the picture of the sound of their own, and of the places of the picture of the walk
of the places of the picture of the kind of the places of the picture behind them that stands of no places of
the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of
the places of the picture of the frequency of the table; the words of the picture of the walk of the places of
the picture of a sound of no places of the picture of the walk of the places of the picture of this kind; and
the places of the picture of the walk of the places of the picture of the sound stood out as the places of the
picture of the walk of the places of the picture of a sound of the kind of the places of the picture of the
walk of the places of the picture of the sound of their own.
