# KaGuYa AN21 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcAN21.cs`, class `An21Opener`
- GARbro tag: `AN21/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `AN21`, and the word at 4 counts a table whose records begin at 8. A record is a type byte:
zero contributes nothing, one skips eight bytes, two to five skip four, and any other value rejects the
archive. Behind the table sits a counted name table of eight-byte entries and then a marker spelling
`[PIC]10`, so the whole preamble has to be walked before the frames are reachable.

The marker is followed by a frame count and a step of 0x12 bytes measured from the count's own position, which
puts the information block right behind it: the reference reads the count and then advances by that constant
rather than past the count first. The block gives the offsets, the width, the height and a channel word that
is multiplied by eight for the bits per pixel.

The first frame follows that 0x14-byte block as a raw image of channels × width × height bytes. Every later
frame carries a step byte and a packed size ahead of RLE pixels whose *declared* output length is
channels × (offsetX + width) × (offsetY + height) rather than the image size — that is how the reference
accounts for neighbouring frame data, and the port mirrors the formula while recording the image size
separately. A step byte of zero rejects the archive, and packed frames use the same interleaved RLE as the
sibling `PL10` format, whose decoder this port shares.

`An21Opener` also accumulates each frame onto the previous one and decodes frames to bitmaps; both happen in
its image path beyond `OpenEntry` and are out of scope here.

## Support

| Capability | Status |
| --- | --- |
| `AN21` signature detection | Supported |
| Table walk with types zero to five | Supported |
| Counted name table and `[PIC]10` marker | Supported |
| Frame count with its stepped information block | Supported |
| Raw first frame | Supported |
| Later frames with step, packed size and the declared output formula | Supported |
| Shared interleaved RLE with simple and extended runs | Supported |
| Frame naming by index and metadata | Supported |
| Frame accumulation and bitmap decoding | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover the preamble walk with two table types, a raw and a packed frame, an unknown table
type, a missing marker, a zero step, and a foreign signature.
