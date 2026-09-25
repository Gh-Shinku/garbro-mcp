# Will Co. image

Reference: `ArcFormats/Will/ImageWIP.cs`, class `WipFormat` with the `Reader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `will-wip-image`
(`packages/formats/src/will/wip-image.ts`).

## It shares its word with the container of the same engine

The same word, `WIPF`, opens the multi-frame container of `ArcFormats/Will/ArcWIP.cs`, which is ported as
`will-wip` (`WIP/MULTI`) and lists every frame of such a file. Both formats are told apart by their names and
by their order: the container carries `.wip` alone, while a picture carries `wip`, `wi0`, `msk` and `mos`, so a
name that only a picture carries - the masks and the base pictures of the engine - reaches this port first,
and a `.wip` stays with the container, which lists its frames. A caller that knows a file holds one picture
can still ask for this format by name. A frame the container hands over is itself a single-frame picture of
this very format.

## The head and the place of the run

The head is thirty two bytes: the number of frames, the depth at 6, the width and the height, where the
picture stands on a larger canvas at 0x10 and 0x14, a word that is nothing, and the length of the frame's
run. Only two depths are stored, eight and twenty four bits. The run does not follow the head directly: the
reference places its stream at `8 + 24 * frames`, so the run stands behind as many records of twenty four
bytes as there are frames - which, for the one-frame picture the head describes, is the place the head itself
ends at. A picture of eight bits keeps its colour map of a hundred and fifty six colours, three bytes each,
in front of the run.

## The run

The control bits are read from the **lowest** bit of a byte up, with the marker in the byte's own high place
telling when a fresh byte is needed; a set bit stands for a byte of its own, a clear one for a copy out of a
kilobyte window. A copy names its place and its count in two bytes - the place from all eight bits of the
first and the top of the second, the count from the bottom four of the second, plus two - and both the place
and the window's own writing place walk on and wrap inside the window, so a copy reads the bytes it has just
written. The window starts as nothing and its writing place starts at one, not at nothing, which the
reference's own first literal shows.

## The picture

A picture of twenty four bits holds **three planes** - blue, then green, then red - and they are drawn
together into the order a bitmap keeps. A picture of eight bits holds one plane of indices into its colour
map, which the file stores red first and the bitmap holds blue first. The reference lays its own unpacked
picture out with four bytes to the pixel whatever the depth; this port does the same, so a run that reaches
past that place is refused rather than writing past it.

Two things are left out, and both are the reference's own default:

* `WipFormat.ApplyMask` is **false** unless a user turns it on, and it is the option that composites a picture
  with the `.msk` that stands beside it; this port keeps the default, which is the picture alone.
* Only the frame the reference unpacks is decoded - the run that stands at the frame place, of the length the
  head names. The frames behind it are what the container port lists, and each of them is a picture of this
  format in turn.

## Verification

Seven tests over synthetic fixtures (`tests/formats/will-wip-image.test.ts`): the three planes of a picture of
twenty four bits drawn together, a copy out of the window that reads what it has just written, the colour map
of a picture of eight bits carried into the bitmap blue first, the place of the run behind two records of
frames, a depth this engine does not store and a run that ends short, the head and the place it names, and the
palette the project's own bitmap writer is handed.
