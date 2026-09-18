# RSystem engine image format

Reference: `GARbro/Legacy/RSystem/ImageRSG.cs`, classes `RsgFormat`, `RsgMetaData` and `RsgReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rsystem/rsg-image.ts` (`rsystemRsgImageDescriptor`,
`rsystemRsgImageFormat`, id `rsystem-rsg-image`, `readRsgLayout`, `unpackRsg`).

The file begins with the two letters `RS`, and the width and the height stand at four and six as words with
the count of chunks at eight. The depth is always reported as thirty two bits.

The pixels stand from the twelfth byte as the count of chunks the head declares. Every chunk begins with a
control byte whose low nibble plus one is how many pixels it holds and whose high nibble says what they are:

| high nibble | what it does |
| --- | --- |
| nothing | that many pixels stand in the stream themselves, three bytes each |
| one | one pixel stands in the stream and is repeated, that many times over |
| four | the word behind the control, times four, is a distance; one pixel that far behind is copied that many times |
| eight | the pixel before stands, and that many words behind it are steps of its three channels — five bits of blue, five of green and six of red, each a **signed** step of its own |

A chunk whose high nibble is none of those is passed over without reading anything, and the walk stops where
the count of chunks or the stream ends. The blue, green and red bytes of a pixel are read and written, so its
fourth byte stands as it was left. The place a chunk of the fourth kind copies from stands still, so every
pixel of that chunk is the same one. A chunk, and a step of a delta, that reach outside the picture are
refused, which the reference's own array reads and writes answer with exceptions as well (documented
deviations in the message only).

The picture is handed out top down, which is what `ImageData.Create` means. The write path of the reference
throws `NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads, the signature and two heads it turns away, the pixels that stand
in the stream, the repeat of one pixel, the copy of a pixel from a distance, a step of the three channels and
a signed step, a chunk whose high nibble is not known, a chunk that reaches outside the picture, the picture
written out again, and a file that is not signed.
