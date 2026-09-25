# AliceSoft image

Reference: `ArcFormats/AliceSoft/ImagePMS.cs`, class `PmsFormat` with the `PmsReader` beside it. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `alicesoft-pms-image`
(`packages/formats/src/alicesoft/pms-image.ts`).

## The head

The picture opens with `PM` and the byte that names which of the two it is, and its head holds the depth at 6 -
eight bits or sixteen and nothing else - the place it stands at, its size, where its pixels begin and where
the plane behind them stands. That last place is **one** field for two roles: the colour map of an eight bit
picture, or the alpha plane of a sixteen bit one. The pixels begin at or behind 0x30 and inside the file.

## The runs

Both depths stand in runs, a byte of every run naming what it holds, and every run walks the row on.

Sixteen bits, a word to the pixel:

* a byte below 0xF8 is the low half of a word whose high half follows it;
* `0xF8` stands for a whole word behind it;
* `0xF9` names a run whose words are made of **two bytes** that carry five, six and five bits between them -
  the first byte the top three bits and two of the green, the second the rest of the green and the blue;
* `0xFA` and `0xFB` stand for the pixels above and to the right and above and to the left;
* `0xFC` draws a pair of words over and over, `0xFD` a run of one word, and `0xFE` and `0xFF` a run copied
  from the two rows above or the one above that.

Eight bits, a byte to the pixel:

* a byte below 0xF8 **is** the pixel, with nothing behind it;
* `0xFC` draws a pair of bytes over and over, `0xFD` a run of one byte that follows, and `0xF8` to `0xFB` a
  byte that follows the control;
* `0xFE` and `0xFF` copy a run from the two rows above or the one above that, and those two are copied
  **progressively**, so a run that reaches into the copy it is making runs on.

A word of this engine therefore carries a different meaning in the two depths: the four codes `0xF8` to `0xFB`
are words of their own in a sixteen bit picture and plain bytes in an eight bit one, and the counts of every
run begin at three and four in the narrower depth where they begin at two in the wider.

## The bitmap

An eight bit picture goes through its colour map, which the file stores red first and a bitmap holds blue
first. A sixteen bit picture without an alpha plane is written as it stands, with the masks the reference
declares for `Bgr565`. With an alpha plane it is written as four bytes a pixel: the alpha of the plane in the
fourth byte, and the three five and six bit channels spread over the whole byte of their own, which is the
conversion the reference hands the picture through.

## Deviations from the reference

* Every read and every run is bounded by the file and by the picture; the reference writes past both.
* A picture of eight bits whose head names no colour map is refused where the reference would read its
  palette from the beginning of the file.

## Verification

Seven tests over synthetic fixtures (`tests/formats/alicesoft-pms-image.test.ts`): the head with the depths and
places it turns away; the runs of a sixteen bit picture, with a run of one word and a copy taken from the row
before at the place the row has reached; the two bytes that carry five, six and five bits, pinned on a word of
nothing but red worked out by hand; the runs of an eight bit picture, where the control byte is the pixel
itself; the colour map reaching the bitmap blue first; the alpha plane drawn into the fourth byte of every
pixel of a four byte picture; and the word the picture is told by.
