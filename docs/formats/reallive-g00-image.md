# RealLive engine picture (`G00`)

Reference: GARbro `ArcFormats/RealLive/ImageG00.cs`, class `G00Format` with the `G00Reader` that unpacks
through it (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/reallive/g00-image.ts`, registered as `reallive-g00-image`.

The file also holds the `G00Reader.LzDecompress` walk that the engine's **archive** uses, and that walk is
ported beside this one in `reallive/g00.ts`: the two share it, as the reference does. The archive carries the
tag `G00/v2` and this picture the tag `G00`, which is why two implementations stand beside each other here.

## The header

The file opens with a **type of nothing, one or two**, the width and the height, which the reference caps at
0x8000. A tiled body then holds the number of tiles; the other two hold the **length of the packed stream**,
which the reference requires to reach exactly to the end of the file, so a picture with anything behind its
stream is not one of these.

## The packed stream

Both stored kinds unfold with `G00Reader.LzDecompress`. Its own header counts its length from its first byte
to the end of the file, which is the word the format's header checks as well, and it names the size the
stream unfolds to. A control byte is refilled whenever the one-bit marker above its bits shifts down to the
sentinel, a set bit copies one pixel as it stands, and a clear bit reads a sixteen bit word whose low four
bits extend the copy length and whose upper twelve bits are the distance -- both counted in pixels, so both
are scaled by the size of one.

The two kinds differ in what a pixel is made of: the stored kind unpacks **three bytes a pixel** and copies
at least one pixel at a time, the indexed kind **one byte** and at least two. The buffer that unfolds is
handed over as it stands, with the row length the reference works out from the width and the depth -- the
packed one, since `ImageData.Create` pads no row.

## The three kinds

* **Stored** (`0`): the unfolded bytes are the pixels, and the picture is twenty four bits deep.
* **Indexed** (`1`): the unfolded buffer opens with the number of colours and their entries, four bytes each
  and blue first, and the pixels follow. The fourth byte of an entry is the reference's alpha, which a
  bitmap palette has no room for, so it is dropped. More colours than an eight bit bitmap can name are
  refused.
* **Tiled** (`2`): the header counts tiles and the table behind them unfolds to a place and a length for
  each. The reference then reads the pieces of **the first tile whose length is not nothing** and lays each
  piece into the picture at the place the tile and the piece give together -- pieces of the tiles behind
  that one are left as they stand, which is what the reference does.

All three are unpacked from the top row down, so the bitmap written for one records a negative height.

## Deviations from the reference

* A stream that does not unfold, unfolds to fewer pixels than the picture declares, or reaches outside the
  picture is refused with `INVALID_ARCHIVE`, where the reference lets its own array accesses throw.
* A palette of no colours, of more than 256, or one that runs past its stream is refused.
* A tile of an unknown kind, a piece that lies outside the picture, a table that names another number of
  tiles than the header, and a picture whose every tile is empty are all refused.
* A picture larger than 256 MiB is refused rather than allocated.

## Verification

Eight fixtures in `tests/formats/reallive-g00-image.test.ts` cover a stored picture, a copy taken out of the
pixels before it, an indexed picture with its palette and the alpha byte a bitmap palette does without, a
tiled picture whose piece lands where its tile and place put it, the listing and its metadata, the header
shapes and the too large picture that are turned away, and the streams that unfold short, name no colour or
mismatch their tile count.
