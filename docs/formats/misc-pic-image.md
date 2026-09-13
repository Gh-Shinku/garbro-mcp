# Soft House Sprite PIC image

Reference: `GARbro/ArcFormats/ImagePIC.cs`, class `PicFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/misc/pic-image.ts` (`picImageDescriptor`, `picImageFormat`, id
`misc-pic-image`).

A bitmap whose file header was replaced by a tag and seven bytes of engine data:

| field | offset |
|---|---|
| tag `PIC` | 0 |
| seven bytes the reference never reads | 3 |
| `bfOffBits` | 10 |
| information header | 14 |
| palette and pixels, as the bitmap lays them out | `bfOffBits` |

`OpenAsBitmap` builds ten bytes — `BM`, the length of the **whole source file** and four zeros — and puts the
source from offset ten behind them. That produces a coherent bitmap: the four zeros are the reserved field, the
source's own bytes ten to thirteen are `bfOffBits`, and the information header follows at fourteen. Because ten
bytes become ten bytes, the extracted file has the length of the source and `sizeKnown` is **true**.

## Why the tag matters even though it is thrown away

The synthesized bitmap overwrites the bytes the tag lives in, so a port that only asked its bitmap reader would
accept **any** file whose bytes from offset ten happened to parse as a bitmap — including one that does not
begin with `PIC` at all. The format therefore re-checks the tag itself rather than trusting the registry's
signature gate, and a test that changes the first byte and still expects a decline is what found the omission.
This is the same lesson the `BM_` port recorded, and the same fix.

## The round trip

For a bitmap whose reserved field is already zero — which is every ordinary bitmap — the synthesized stream is
the **original file, byte for byte**, and the strongest test here asserts exactly that. A second test fills the
reserved field with `0xDEADBEEF` in the source and expects zeros in the output, because those four bytes are the
ones the reference builds rather than ones it copies. A third fills the seven bytes between the tag and offset
ten with a marker and shows they reach nothing.

The palette and pixel bytes are carried through untouched, which a test checks for an eight bit image: the whole
stored palette and its pixels appear in the output at the offsets a bitmap uses.

## Notes

* Metadata carries the dimensions and the depth read from the information header, and the archive metadata also
  records the ten byte prefix. The reference declares no extensions and the port matches.
* A bitmap whose information header is shorter than forty bytes, a file too short to hold one, a wrong tag and
  zero dimensions are all declined, the last as a documented deviation.
* The reference can write, by saving a bitmap and putting the tag and the gap back; detection, listing and
  extraction are what the port implements.
