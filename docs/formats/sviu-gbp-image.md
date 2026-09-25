# SVIU system image (GBP)

* Reference: `ArcFormats/Sviu/ImageGBP.cs` (classes `GbpFormat` and the `GbpReader` beside it), GARbro
  commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `sviu-gbp-image`; tag `GBP`; extension `.gbp`.

## Head

The picture opens with the word `GYBP`, which stands as it stands. Behind it the head is hidden: the file
carries a key of nineteen places at its own end, and the head stands of the key and the places behind it:

```text
for (i = 4; i < 0x14; i += 2) { header[i] ^= key[0x10]; header[i+1] ^= key[0x11]; }
for (i = 0; i < 0x10; ++i) header[i+4] -= key[i];
```

| at | what stands there |
| --- | --- |
| 4 | where the lengths of the places of the picture stand |
| 8 | where the lengths of the places themselves stand |
| 0xc | the kind the picture stands of: 1, 2 or 3 |
| 0xe, 0x10 | the places of the picture |
| 0x12 | the places of a place of it |

The places of a colour stand in front of the places of a colour: at the head's two places stand as many words
of four bytes as the picture has colours, every one of them the length of the places behind the word before
it. The places of the first colour stand behind the last word, and the places of every colour stand behind
the lengths of the colour before it.

## The kinds

| kind | what the places of a colour stand of |
| --- | --- |
| 1 | one control place to a place of the colour, and then the place itself or a run of the places behind it |
| 2 | the walks of the engine's own reader |
| 3 | blocks of eight places by eight |

The places of a colour are carried: every place of it stands on the places before it in the same colour.

Where the control places of the first kind name a place of the colour as it stands, the place behind them is
the place itself; where they name a run, the two places behind them are a word of which the four lowest
places name how many places stand, three off, and the places above them name the place the run stands of.
The places a run stands of may reach into the run itself, which then repeats the places it has written.

## The walks of the engine

A walk stands of a frame of 0x1000 places, filled with nothing, which the walk of the picture begins near
the end of (0xFEE). A place standing clear in the control places of the walk names a place of the picture as
it stands; a place standing set names a word of which the four lowest places name how many places stand,
three off, and the places above them the place of the frame the run stands of. The frame is written as the
picture is written, so a run reaching over the places it has written repeats them.

## The blocks of a picture

A picture of the third kind stands of blocks of eight places by eight. Every colour of the picture carries
its own words: how long the control places of the blocks stand, how long the places of the blocks stand, and
how many places the words of the blocks stand of. The places of the blocks stand behind those words, and the
places the blocks stand of stand behind them. A place standing set in the control places of a block names one
place of the block data which every place of the block stands of; a place standing clear names the places of
the block from the words of the block, one place after another. The places of a colour of this kind are not
carried.

## The alpha of a picture

A picture of four places to a pixel carries the alpha of its places behind the places of its colours: pairs
of a place and, where the place stands of nothing or of every place, how many places stand of it.

## Deviations

* A picture of a depth other than three or four places to a pixel is turned away, where the reference hands
  over a picture of one or two places as one of three colours.
* Every read is bounded, and a picture whose words or places stand short of the file, or whose run reaches
  outside the picture, is turned away.
* The places of the alpha of a picture stand only on the first kind, as the reference has it.
* The places of a picture are handed over as a bitmap of four places to a pixel, of the places the reference
  states.

## Verification

Seven tests over synthetic fixtures (`tests/formats/sviu-gbp-image.test.ts`): the head of a picture taken
back out of the key it carries, a picture whose key stands broken, the word of another engine, a picture of
another depth and a file standing short of its own key; the places of the colours carried one after another;
a run of the places behind a colour, standing over the places it has written; a walk of the engine's own
reader, and the same places standing as they stand for the sake of the walk behind them; a picture standing
of blocks of eight places by eight; the alpha of a picture of four places to a pixel; and the word the format
tells a picture by.

A picture standing of the third kind with four places to a pixel, and the places of the block data standing
short of the picture, stand in the port as they stand in the reference but no fixture of them was finished;
they stand among the places still to be verified of the record of this format, together with the differential
against the reference on real files.
