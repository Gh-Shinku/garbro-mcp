# FrontWing image formats

Reference: `GARbro/ArcFormats/FrontWing/ImageFG.cs`, classes `FwgiFormat`, `FweiFormat` and `FgMetaData`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/frontwing/fg-image.ts` — `frontWingFwgiImageDescriptor` /
`frontWingFwgiImageFormat` (id `frontwing-fwgi-image`) and `frontWingFweiImageDescriptor` /
`frontWingFweiImageFormat` (id `frontwing-fwei-image`), with `readFwgiLayout`, `readFwgiBitmap`,
`assembleFwei` and `unpackFwei`.

## FG/FWGI — a bitmap of its own

The word `FWGI`, the word `1` at four, the offsets of the picture at twelve and sixteen, the width and the
height at `0x1C` and `0x20`, and the place and the size of the bitmap at `0x128` and `0x12C` — where the
place stands **four bytes before** where the bitmap really is. The depth is always reported as thirty two
bits. The region itself is read as a bitmap, with the same reader the other bitmap ports share, and handed
on. Where the region is **no** bitmap, `FweiFormat.OpenImage` hands it to the decoder of the platform, which
reads whatever kind of picture it holds; this port reads the JPEG and PNG interchange formats itself, which
are the two those decoders are used for in practice, and turns a region of any other kind away with
`INVALID_ARCHIVE`.

The bitmap of a region that is neither of those two kinds of picture is nevertheless reported by the head of
the file with the width and the height it names, exactly as the reference reports them.

## FG/FWEI — an encoded stream and its companion

The word `FWEI` stands at nought and nothing else of the file is a head: its own data begins at the fifth
byte. Everything else comes from the companion the reference names, the same name with the extension `.fge`,
of exactly `0x818` bytes:

* the size of the first piece stands at nought of the companion and the piece itself from four;
* the place and the size of the last piece stand at `0x404` and `0x408` and the piece itself from `0x40C`;
* the word at `0x810` says whether the whole stream is packed;
* the **middle** pieces stand in the file itself, from its fifth byte, of as many bytes as the place of the
  last piece says beyond the first piece's size;
* everything the file holds behind that middle is appended after the last piece.

The stream so assembled is unfolded from a zlib stream where the companion says it is packed, and the result
is read as a picture of the older kind. Without the companion there is nothing to read: the reference throws
rather than passing the file over, and so does this port — which is also why detecting this kind asks the
companion to stand beside the file.

The write paths of both formats throw `NotImplementedException`, so this is a read only pair.

The tests cover the head of the older kind, the word, version and places it is turned away for, the bitmap
it points at handed on, a region that holds a JPEG and one that holds a PNG, a region that holds neither, the
assembly of the encoded stream out of its companion both as it stands and packed, the refusal of a companion
of the wrong size, the refusal of an encoded picture without its companion, and a file that is not signed.
