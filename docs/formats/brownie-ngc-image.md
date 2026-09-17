# Brownie image format

Reference: `GARbro/Legacy/Brownie/ImageNGC.cs`, classes `NgcFormat`, `NgcMetaData` and `NgcReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/brownie/ngc-image.ts` (`brownieNgcImageDescriptor`,
`brownieNgcImageFormat`, id `brownie-ngc-image`, `readNgcLayout`, `unpackNgc`).

The file is signed `NG/B`, and the width and the height stand at `0x14` and `0x18` as words with the size of
the bit line at `0x1C`. The depth is always reported as twenty four bits.

The picture stands from `0x20` as whole rows of three bytes a pixel, each behind a command byte:

| command | what it does |
| --- | --- |
| `0` | the row above is repeated |
| `2` | a masked row: the mask stands in as many bytes as the head declares, and its set bits take a byte from the stream while its clear ones take the byte a row above |
| `3` | three run length coded channels, one a channel, interleaved across the row |
| anything else | the row stands in the stream as it is |

A run length channel walks the whole plane, not one row: it steps three bytes at a time from where the row
begins until the picture is filled. A control byte above nothing is a count of one value that stands behind
it, and nothing is a count of bytes that stand in the stream themselves, of which a count of nothing ends the
channel. A masked row is read from the **highest** bit of every byte of the mask down, and a row that would
take a byte from above the first row is refused, which the reference's own array read answers with an
exception as well (a documented deviation in the message only).

The picture is handed out with its rows **bottom up**, which is what `ImageData.CreateFlipped` means. The
write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads, the signature and two heads it turns away, the measurements the
port reports, a row that stands in the stream, the row above repeated, three run length coded channels and a
channel of bytes that stand in the stream, a masked row against the row above, a row that reaches above the
first one, and a file that is not signed.
