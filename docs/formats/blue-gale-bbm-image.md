# BlueGale BBM obfuscated bitmap

Reference: `GARbro/ArcFormats/BlueGale/ImageBBM.cs`, class `BbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/blue-gale/bbm-image.ts` (`bbmImageDescriptor`, `bbmImageFormat`, id
`blue-gale-bbm-image`).

A bitmap whose **leading bytes are exclusive ored with `0xFF`** — but only the leading bytes. The reference
unmasks a hundred byte prefix and passes everything past it through untouched, which is the part of this format
worth recording.

Detection reads thirty two bytes and checks two words **while they are still masked**:

| check | masked value | what it is |
|---|---|---|
| word at 0 | `0xB2BD` | `BM` exclusive ored with `0xFF` |
| word at 6 | `0xFFFFFFFF` | the bitmap's two reserved zero bytes, masked |
| word at 0xE after unmasking | `0x28` | the forty byte DIB header |

The first version of the port unmasked the header before the marker check and compared against `0x4D42`; the
test failed immediately, showing that the reference's odd looking constants are simply the bitmap's own fields
seen through the mask. The header is consistent enough that the masked `BM` doubles as a magic number, and the
tests assert the relation rather than repeating the constant.

Extraction is where the hundred byte boundary matters:

* `Read` unmasks the first hundred bytes and prefixes them to the rest of the file, so for a twenty four bit
  image — where the whole file is a header and pixel data — the entire file is restored, while for an eight bit
  image the **palette starts past the boundary and stays masked**. The reference hands those bytes to the
  decoder as they stand and the port copies them as they stand, which two tests pin: one asserts that the
  first hundred bytes come back restored and the bytes past them do not, the other reads a palette entry at
  offset 854 and checks it is still masked;
* because `ReadHeader(100)` throws when the stream is shorter, a file under a hundred bytes cannot be read at
  all, even though detection only needs thirty two. A test truncates a valid file to forty bytes, asserts that
  it still lists, and asserts that extraction fails;
* the unmasked payload is validated with the shared `readBmpMetaData` and trimmed to the bitmap's own `bfSize`;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `encrypted: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, the dimensions and the depth; the archive metadata records
  `image: "bmp"`, `encrypted: true`, the `unmaskSize` and the dimensions;
* the reference declares no signature and no extension gate, so every file is a candidate and the masked marker
  is the only way in. Deviations, all tested: a wrong marker, a wrong reserved word, a wrong DIB size, a file
  shorter than the thirty two byte probe and zero dimensions are declined.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.

## Two fixture corrections

The first fixtures were a seventy eight byte twenty four bit image and a bitmap masked only in its first hundred
bytes. Both made the tests fail against a correct port: the short image is one the reference itself cannot read,
and masking only the prefix meant the tail was never obfuscated, so the assertions that expected masked bytes
there were checking a property the fixture had never established. The fixtures now clear a hundred bytes and
mask the **whole** file, which is what makes the hundred byte boundary observable at all.
