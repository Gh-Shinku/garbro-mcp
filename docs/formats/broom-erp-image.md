# Studio B-Room image (`ERP`)

* Reference: `GARbro/Legacy/BRoom/ImageERP.cs` (`ErpFormat`, `ErpReader`, `ErpKey`)
* Port: `packages/formats/src/broom/erp-image.ts`, record `broom-erp-image`
* Tests: `tests/formats/broom-erp-image.test.ts`

## Layout

The first three bytes of the file are not nought, `0x45` and `0x59` (`signature & 0xFFFFFF00` stands of
`0x26594500`), and the first byte names which key of the engine the picture stands of. The head of 0x14
bytes is keyed: its place at 4 and the places behind it are exclusive-ored with the head key, and the
picture's depth, width and height stand of the key tables at the place the first byte names.

Of the three places of the key tables (0 to 2) the picture stands of the one whose depth reads 8 or 24; the
width and height of the head stand of four places each. The reference keeps the place of the last picture
it read and asks after the ones behind it only where the depth of that place stands of no picture; this
port asks after every picture.

An 8 bit picture holds a colour map of 256 colours at 0x14; a 24 bit picture holds its places there.

## The walks of the engine

The keys of the walks step on by a place of the key tables after every run of the places of the picture
(`ErpKey`: `value += step`, and `value -= 0xFF` where the value stands above 0xFF). Four kinds of walk:

* **8 places to a place**: a place and a count, exclusive-ored with 9 and 13, of a run of one colour.
* **kind 0**: a place of three colours and a count, of a run of the places behind it (the places of a run
  stand of the places of the run before them).
* **kinds 1 to 6**: a list of counts, and then the runs of every colour of the picture, of one of the six
  orders of the three colours; a count of nought where the count of a walk and its key stand of one another.
* **kinds 7 to 12**: the runs of the three colours of the picture behind one another, then the places of
  every place of it drawn together.

## Deviations

* **The place of the key tables.** The reference holds the place of the last picture it read, so a file of
  another place can be read of the keys of the picture before it. This port asks after the head of every
  picture alone.
* **Places past the end of the file.** A walk that stands short of the file stands of the places it has read
  (the reference reads them as noughts).
