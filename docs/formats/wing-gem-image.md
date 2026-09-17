# Wing image format

Reference: `GARbro/Legacy/Wing/ImageGEM.cs`, classes `GemFormat`, `GemMetaData` and `GemReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/wing/gem-image.ts` (`wingGemImageDescriptor`, `wingGemImageFormat`, id
`wing-gem-image`, `readGemLayout`, `unpackGem`).

The reference registers two signature words, `0x14000A` and `0x32000A`, whose **third byte** is at once part
of the signature and the alpha value: twenty or fifty. The word at four is the method — `0x64` walks the
pixels differentially and `0xE6` leaves them as they stand — the word at six is the depth, of which only
**thirty two** bits is read, and the height and the width stand at eight and ten. A method or a depth the
reader does not know is turned away.

The pixels are an LZSS stream of thirty two bit rows. Where the stream holds less than the picture asks for,
the reference's own reader leaves the rest of it at nothing, which this port does as well. Method `0x64` then
walks the rows: every pixel behind the first of a row and behind the first row is the sum of itself, the pixel
to its left, the pixel above it and the pixel above left taken away, all held to eight bits, and the pixels it
reads are the ones already restored, so the walk goes left to right and top to bottom. When the signature's
third byte is fifty the alpha channel is there, and every fourth byte is turned over with `0xFF`; when it is
twenty the picture is handed out as `Bgr32` and the fourth byte stands as it was stored.

The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads, the two signature values, the two methods and the depth, the
measurements and the presence of the alpha channel, the plain method with and without its alpha channel, the
differential walk with the alpha channel turned over, a stream that stops before the picture is whole, and a
file that does not hold a picture.
