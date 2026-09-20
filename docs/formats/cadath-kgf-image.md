# Cadath image format (`KGF`)

Reference: GARbro `ArcFormats/Cadath/ImageKGF.cs`, classes `KgfFormat`, `KgfMetaData`, `KgfDecoder` and
`KgfDecoder.InputBuffer`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A picture of the Cadath engine whose places stand in one of six kinds of walk. The places of a place of the
picture stand in four places of the picture where the words of the head of the picture name a picture of the
places of the picture of two and thirty places, and in three where they name a picture of the places of the
picture of four and twenty.

## Head

| place | word |
| --- | --- |
| 0 | the places of the picture `KGF` |
| 4 | how wide the picture stands (u32) |
| 8 | how tall the picture stands (u32) |
| 0xC | the places of a place of the picture (i32: 24 or 32) |
| 0x10 | the kind of the walk of the places of the picture (i32: 0..5) |

A place of the picture of any other kind of the places of the picture turns the picture away. The kinds of
the walk of the places of the picture of the kinds of the walk of the places of the picture of the
compression of the pictures of the engine stand eight places behind the words of the head of the picture, at
`0x24`, and the places of the picture of the walk of them stand four places behind the words of the walk of
them, at `0x28`.

## The kinds of the walk

* **0** — the places of the picture stand as they stand, from `0x1C`.
* **1** — the places of the picture stand beside each other of the places of the picture of a place of the
  picture of their own, and are walked into the places of the picture of every place of the picture of the
  walk of them.
* **2** — a walk of the places of the picture of a head of three words: how many places of the walk of the
  picture stand, how many places the places of the walk of them stand in, and how many places of the picture
  stand of their own. Every place of the walk of the picture stands for the places of the picture of the
  words of the walk of the picture behind it (a run of at least three places) where the place of the walk of
  the picture of it stands, and for the places of the picture of a word of its own where it stands not. The
  places of the walk of the picture stand of the places of the picture of the walk of them, the first place
  of the walk of the picture standing in the place of the picture behind the first.
* **3** — the places of the walk of the places of the picture of the kind of the compression of the pictures
  of the engine stand as they stand.
* **4** — the same, the places of the picture standing beside each other of the places of the picture of a
  place of the picture of their own.
* **5** — the same, the places of the picture of every place of the picture standing as the places of the
  picture of the place of the picture of the column of the picture behind them of the places of the picture
  of the walk of them. The places of the picture of a column of the picture stand beside each other; a place
  of the picture of the walk of the picture that stands for the places of the picture of the column of the
  picture of the picture itself stands for that column of the picture of every row of the picture of the
  walk of them.

## The walk of the places of the picture of the compression of the pictures of the engine

`KgfDecoder.Decompress` stands two walks of the places of the picture beside each other. A picture of the
places of the picture of `0x100` places (and of `0x200` in the kind of the walk of the places of the picture
of the fifth kind) stands of the places of the picture of the walk of them of a picture of `0x20` places
(`0x40`), which stands of the places of the picture of the walk of them itself, so the places of the walk of
the picture stand in two levels of the places of the picture.

`InputBuffer` stands the places of the picture in the places of the picture of the words of the walk of the
places of the picture behind them: a place of the walk of the picture that stands for the places of the
picture of the words of its own stands for the places of the picture of no places of their own, and a place
of the walk of the picture that stands for the places of the picture of their own stands for a word of the
picture. The places of the picture then stand as the places of the picture of the runs of the places of the
picture of the walk of them of the places of the picture before them — the last place of the picture of a
chunk of the places of the picture standing in the first place of the picture of the chunk behind it.

## Deviations from the reference

* The reference stands a picture of the kinds of the places of the picture it stands no places of the
  picture of the place of the picture of a kind of the places of the picture of their own, so a head that
  names no picture of this kind turns the picture away rather than standing it out.
* The reference reads the places of the picture of the walk of the places of the picture of the kinds of the
  walk of the places of the picture of a picture beyond the places of the picture of the words of the head of
  it no places of the picture, the places of the walk of the picture standing short of the places of the
  picture turning the picture away of the project.
* `packed_size` (the word of the head of the walk of the places of the picture of the compression of the
  pictures of the engine at `0x24`) stands read and no places of the picture of the walk of the picture
  stand of it, of the reference — the walk of the places of the picture of the compression of the pictures
  of the engine running to the end of the file.

## Verification

Eleven fixtures of synthetic pictures stand against the walk of the places of the picture: the head of the
picture and the words of the picture of the kinds of the walk of the places of the picture it names; the
places of a picture of each of the six kinds of the walk of the places of the picture; the places of the
picture of the walk of the places of the picture of the kind of the compression of the pictures of the
engine of the places of the picture of their own, beside them, and of the places of the picture of the walk
of them; the places of a picture that stands short of the places of its walk; and the picture stood out as
the places of the picture of its own.

The walks of the places of the picture of every kind stand covered of a picture of one place of the picture
of the walk of them. The places of the picture of the walk of the places of the picture of the kind of the
compression of the pictures of the engine stand covered of a picture of one place of the picture of the walk
of them; the walks of the places of the picture of more than one place of the picture, and the places of the
picture of the word of the walk of the picture that stand across the places of the picture of the chunks of
them, stand uncovered.
