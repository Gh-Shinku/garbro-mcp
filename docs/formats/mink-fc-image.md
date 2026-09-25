# Mink compressed bitmap (BMP/FC)

* Reference: `Legacy/Mink/ImageFC.cs` (classes `FcFormat` and the `FcReader` beside it), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `mink-fc-image`; tag `BMP/FC`; extension `.fc`.

## Head

The picture opens with eight bytes: `F`, then `C` of either case, then the places of a place of the picture
(24 or 32), then a kind (0 or 1), and then the places of the picture as two words. The reference registers
the eight heads those four fields make as its signatures, and this port registers them the same way.

## The bits

The bits of a picture stand in words of four bytes, of which the highest of the first stands first, and the
places behind the end of the picture stand of nothing.

The reference keeps them in a word it refills as it empties, with a place set in the word it has emptied so
that a refill is not made in the middle of it, and takes the places a call asks for from the highest one
down. That arithmetic is not a plain walk over the bits in every case - where a call asks for more places
than the word holds, the reference takes the places standing short from the word behind it and carries the
rest of it over - but it stands here as it stands in the reference:

```text
uint val = m_bits >> (32 - count);
m_bits <<= count;
if (0 == m_bits) { ... takes the places standing short from the word behind ... }
```

A walk of sixteen thousand calls over words of the bits, of every length a call of this engine makes (1, 2,
3, 4, 8, 16 and 24 places) and of several kinds of picture, stood of the same places as a plain walk over the
same bits, so the port reads the bits a word at a time from the highest of it down.

A run of the bits stands of a count and the places behind it: the count stands of as many set bits as stand
in front of the first clear one, and the places behind it stand of the value that count names, which the
reference takes two off. The runs of the colours of a place are read as the place standing lowest of the run
names the sign, and they stand of the place of the colour they name: the first of them the lowest colour of
a place, then the one behind it, then the one behind that.

## The words of a picture

The bits name one of five things for every place of the picture, in this order:

| the bits | what the place stands of |
| --- | --- |
| `0`, then `1` | the place before it or the place above and to the left of it, every colour taking a run of its own |
| `0`, then `0` | the place before it, every colour taking a run of its own |
| `10`, then `0` | the place above and to the left of it, every colour taking a run of its own |
| `10`, then `1` | the place of the greys the picture takes its runs from, every colour taking a run of its own |
| `11`, then `1`, then `0` | the place above and to the left of it |
| `11`, then `1`, then `1`, then `0` | the place above and to the right of it |
| `11`, then `1`, then `1`, then `1`, then `0` | the place above it |
| `11`, then `1`, then `1`, then `1`, then `1` | the place above and to the left of it |
| `1100` | a place of three colours, as it stands in the bits |
| `1101` | the place the walk has reached, handed over as many times as a run of the bits says |

## The three passes of a picture

The places of the colours of a picture stand of the bits first, then - for a picture of four places to a
pixel - the alpha of every place stands of a run of its own (`1101`-like runs of a place of eight bits and a
count). A picture of the second kind then takes the colours of every place below its first row over the
colours of the place above it: every colour of the place above stands below, with a place of the greys taken
off it.

## The picture stands bottom up

The reference hands the picture over through `ImageData.CreateFlipped`, which makes a bitmap of the places
it read and then turns it about (`ScaleTransform { ScaleY = -1 }`). The places of a picture of this engine
therefore stand from the bottom of it up: the row the walk reads first is the bottom row of the picture. The
port hands the picture over as a bitmap whose rows stand bottom up, which is the same picture.

## Deviations

* Every read is bounded: a picture standing short of the places it names, a head of a kind this engine does
  not know, and the places of the picture standing short of the file are handled as the reference handles
  them - the places behind the end of the picture stand of nothing.
* A run of the alpha naming more places than stand in the picture, and a run naming more places than are
  left of it, stop at the place the picture ends at; the reference walks past the end of its own buffer.
* A place named before the first place of the picture stands of nothing rather than of the place it names.

## Verification

Eight tests over synthetic fixtures (`tests/formats/mink-fc-image.test.ts`): the head of a picture and the
ones it turns away, of the eight heads this engine names; the places of a picture taking their colours from
the place before them and from the place of the greys; the places taken from the place above and from the
ones beside it; a place of three colours standing as it stands in the bits, and a place the picture takes in
a run; the alpha of a picture of four places to a pixel; the second kind of picture, whose colours stand
below the place above them; a picture whose words stand short; and the head the format tells a picture by.

The places taken from the place above and to the left, and the runs of the alpha naming more places than the
picture holds, stand in the port as they stand in the reference but no fixture of them was finished; they
stand among the places still to be verified of the record of this format, together with the differential
against the reference on real files.
