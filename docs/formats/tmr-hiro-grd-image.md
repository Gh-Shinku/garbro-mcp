# Tmr-Hiro ADV System image

Reference: `ArcFormats/Tmr-Hiro/ImageGRD.cs`, class `GrdFormat` with the `GrdReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `tmr-hiro-grd-image`
(`packages/formats/src/tmr-hiro/grd-image.ts`), beside the archive (`tmr-hiro-pac`) and the audio
(`tmr-hiro-audio`) of the same engine.

## The head

The picture writes no word of its own. It opens with two bytes of its own version - the first of them one or
two, the second one, one hundred and sixty one, or one hundred and sixty two, and that second byte is also the
way its channels are packed - then the size of the screen it was drawn on (the width of which the reference reads and never looks at
again), its depth (twenty four or thirty two bits and nothing else), where it stands inside that screen as a place from each of its four sides, and how
long each of its four channels is. Its width is the place between the two horizontal sides and its height the
place between the two vertical ones, both of them taken as they are, so a picture drawn from the right or from
the bottom stands no differently; where it stands is the left side and the **distance of its bottom from the
top of the screen**, since the screen is measured downward.

The four lengths and the head have to add up to the whole file. That is what tells a file of this engine from
any other, and it is the only thing that does: a picture whose channels are described wrongly, or which
carries a byte too many, is turned away.

## The channels

The channels stand one behind the other, and every one of them fills **its own byte** of every pixel: the
alpha of a thirty two bit picture that carries one first, then the red, then the green, then the blue. A
thirty two bit picture without an alpha channel is drawn as four bytes a pixel as well, its fourth byte left
as it stands.

The rows of a channel are taken from its **last** one up into the rows of the picture - the reference draws
its output in the order it reads the channels, and does not flip it - so what the picture holds stands the
other way round from the screen it was drawn on.

## The three ways a channel is packed

The second byte of the head names one of them, and it is the same way for all four channels of a picture.

* **A run of its own** (a second byte of one): a count above a hundred and twenty seven names one byte written
  over and over that many times, a count below it that many bytes that stand as they are, and a count of
  nothing is passed over. The walk counts the bytes it reads and is bounded by the length of the channel.
* **A tree of its own** (one hundred and sixty one, and one hundred and sixty two): the channel opens with how
  long it unfolds to, how long it is stored - a word that is read and never looked at again - and how often
  each of the two hundred and fifty six bytes stands. The tree is built by taking the two nodes of the lowest
  count over and over out of a list that keeps the order counts came in when they stand equal, and its root is
  always the last node built. A bit that is set takes the right branch of a node and a clear one the left,
  until a node below the two hundred and fifty sixth stands for a byte of its own. **The bits stand from the
  lowest of a byte up**, so the first byte of a channel names its first eight decisions.
* **A walk of its own** (one hundred and sixty two, behind the tree): the bytes the tree unfolds to open with a
  word of twelve, the ninth of which is the value the walk watches for. Every other byte stands as it is; the
  watched value followed by itself stands for that same byte; and the watched value followed by two more names
  a copy - a place, which is stepped down by one when it stands above the watched value, and a count - out of
  the bytes the walk has reached, copied **progressively**, so a run that reaches into itself runs on.

A channel packed the third way stands as a tree of its own whose bytes are the walk; a channel packed the
second way stands as a tree of its own whose bytes are a run.

## Deviations from the reference

* Every read is bounded by the file and by the channel; the reference reads past both.
* A tree the file does not hold in full, or a walk whose bits run out before the channel is drawn, is refused.
* Writing a picture is not implemented, as in the reference.

## Verification

Eight tests over synthetic fixtures (`tests/formats/tmr-hiro-grd-image.test.ts`): the head accepted and turned
away when its depth, its pack way or its four lengths do not hold together; a twenty four bit picture whose
channels stand as runs, with the rows taken from the last one up and every channel in its own byte; a thirty
two bit picture with its alpha channel in the fourth byte, and one whose head names none; a channel unfolded
out of a tree of its own, the tree and the codes of it written the other way round by the test; a channel
whose bytes stand behind a walk of their own, with a copy that reaches into the bytes it has just written and
the watched value standing as itself; and the picture told by its head rather than by any word.

The walk test caught a real port bug: the bytes a tree unfolds to stand at the length **the tree names**, not
at the length of the channel they are drawn from, and a buffer of the wrong length left the walk reading a
byte that was not there.
