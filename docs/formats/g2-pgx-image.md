# Glib2 engine PGX image

Reference: `ArcFormats/Glib2/ImagePGX.cs`, class `PgxFormat` (tag `PGX`), whose own walk is the
`GOpener.LzssUnpack` of the **Glib** engine (`ArcFormats/GLib/ArcG.cs`). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `g2-pgx-image`
(`packages/formats/src/g2/pgx-image.ts`) on the shared walk `packages/formats/src/glib/glib-lzss.ts`.

## The head

The picture opens with the word `PGX` and a head of twenty-four bytes: its width and height, a field whose
**lowest bit** tells the depth - nothing means three bytes a pixel and one means four - a field of flags, and
the size the picture takes when packed. The run itself begins at 0x20, behind the head.

## The walk both Glib engines share

`GOpener.LzssUnpack` is unlike the other walks this project carries in three ways, and all three are what its
fixtures pin:

* its control word is read from its **low** bit upward, where a **set** bit stands for a byte that stands as
  it is and a clear one for a pair of bytes;
* the bytes those decisions stand for take turns with the control words through the stream: a control byte,
  the bytes of its eight decisions, the next control byte, and so on;
* the pair names a place in a frame of four thousand and ninety-six bytes as `(hi & 0xF0) << 4 | lo`, and the
  run's length from the **bottom half** of the high byte as `(~hi & 0xF) + 3` - where the other walks of this
  project count from the top half instead. The frame's cursor begins near its end, at 0xFEE, and wraps.

The walk reads the input in one run, so its own end is handed back and a caller may read on behind it.

## The block of the engine's own information

When the picture's flags carry 0x1000, a block of sixteen bytes stands in front of the picture. Four pairs of
its bytes are swapped about before it can be read - a pair at a time, so the swap is its own undoing - and the
word at its twelfth byte names how large the block becomes when unpacked. That block is unpacked with the
same walk and then **left aside**: it is the engine's own information rather than a picture, so only the place
it ends at matters, and the picture's run is read from there.

## Deviations from the reference

* The reference reads a **sibling file** of the engine (`InfoReader.GetInfo`) to learn where a layer stands,
  and sets the picture's own offsets from it. That file only moves the picture about, never changes a byte of
  it, so this port leaves it be and the offsets stand at nothing.
* A picture of three bytes a pixel is unpacked into four and this port draws its rows together again before
  writing a bitmap, where the reference hands the four byte rows on with a three byte format.
* Every read is bounded to the file, a picture larger than this project will hold is refused, and so is an
  information block of a size no file could hold.

## Verification

Eight tests. Four of them are for the walk itself, on streams written out by hand: the layout of a stream is
pinned byte for byte (a control word of 0x0F, four bytes that stand as they are, and a copy pair), a copy
proves both halves of its encoding by reading back the four bytes it stands over, and one run carries the
frame's cursor past its own end so the copy that follows reads the frame **from its first byte** - which is
where the first of those bytes still stands. The other four cover the head (both depths), a picture of four
bytes a pixel, one of three bytes whose rows are drawn together, the information block stepped over - with the
picture's own run read from behind it - and the refusals.

What stands on the reference alone: the sibling `.stx` file of the engine and the offsets it carries are not
read here, the packed size in the head is carried but not checked against the run, and no real picture is on
hand to compare against GARbro's output.
