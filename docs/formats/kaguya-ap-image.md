# KaGuYa AP image (and the helper its subclasses share)

Reference: `GARbro/ArcFormats/Kaguya/ImageAP.cs`, class `ApFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/ap-image.ts` (`apImageDescriptor`, `apImageFormat`, id
`kaguya-ap-image`, plus the exported `readApFields` and `readApBitmap` helpers).

| field | offset |
|---|---|
| marker `AP` | 0 |
| width (`u32`) | 2 |
| height (`u32`) | 6 |
| depth (`i16`) | 0xA |
| pixels, bottom row first | 0xC |

## The base of three formats, so its helper is exported

`ApFormat` is the base class of `AoFormat` and `Aps3Format`, and the same file also holds the unrelated
`Ap0Format`. The reference shares `ReadBitmapData` with its subclasses as a protected method, so the port
exports `readApFields` and `readApBitmap` rather than keeping them private and copying them: the subclasses
differ only in their header. `readApFields` takes the marker and the header length as parameters for exactly
that reason.

`Signature` is zero, so nothing is registered as a signature and the probe checks the marker itself — the same
arrangement as PTI and SFG. The five declared extensions (`bg_`, `cg_`, `cgw`, `sp_`, `aps`, `alp`, `prs`) are
**not** a gate: the reference only lists them, and detection is by content.

## Rows are read straight through and written backwards

This is the part of the helper that is easy to get wrong, and the port got it wrong first time. The loop
counter is the **destination** row, counting down from the last one, while the stream itself is read
**sequentially**: the file's first row is the image's *bottom* row and lands in the buffer's last row. Reading
at `dataOffset + row * stride` produces an unreversed image that looks plausible and reverses nothing.

Each row has to arrive whole — the reference throws when a read returns short — so a truncated image lists
successfully and fails on extraction. The output is **top down** (`ImageData.Create`, so a negative height).

## The depth is a label

The depth may be twenty four or thirty two, and the reference reports whichever it read, but the pixels are
**four bytes either way**: there is no three byte path. The port writes a thirty two bit bitmap in both cases
while the metadata keeps the stored number, and a test pins both halves of that.

Neither dimension is tested for zero, only for exceeding 0x8000, so an empty image is a valid one and extracts
to a bare bitmap header.

## A fixture note

The first version of the test built a "row" of four bytes for a two pixel image, which is half a row, and then
supplied two of them for a two row image — a file one row short of what the header promised. The failure looked
like a port bug (an out of range read) but the fixture was twenty bytes where the header called for twenty
eight. When a read is out of range on a synthetic fixture, count the **bytes a row**, not the pixels: a two
pixel image has eight byte rows because the pixels are four bytes each.

## Notes

* `Write` is implemented in the reference — and always writes a depth of twenty four — but this port is a
  reader; `create` is false, as for every other format here.
* Because the extraction gains a header, `sizeKnown` is false.
