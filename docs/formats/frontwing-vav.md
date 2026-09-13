# FrontWing ADV System resource archives (PAK/vav)

## Reference and attribution

- GARbro reference: `ArcFormats/FrontWing/ArcVAV.cs`, classes `PakOpener`, `VavEntry` and `VavArchive`
- GARbro tag: `PAK/vav`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `vav` and carries a version that must be 100, 200 or 201.

## Layout

```
[u8 'vav'] [i32 version at 0x04] [i32 count at 0x08] [u32 index offset at 0x0C]
[records] [payloads]
```

The count must be sane, which means greater than zero and below 0x40000. Records hold a fixed name field whose
size follows the version, sixteen bytes below 200 and thirty two from 200 on, followed by a fixed footer:

| Offset | Field |
| --- | --- |
| 0x00 | stored size |
| 0x04 | unpacked size |
| 0x08 | payload offset |
| 0x0C | compression flags |

Every payload has to fit inside the file. An archive whose base name is `voice` marks all of its entries as
audio.

## Compression

`OpenEntry` runs the codecs in this order:

- `0x80` runs the huffman decoder;
- `0x10` runs the rle decoder;
- the low nibble is the stride of the decryption step.

The huffman stream starts with 256 weights, each keyed with `0x55`, and a symbol 0x100 that starts with weight
one. The tree is built by repeatedly picking the two lightest non-zero nodes and merging them into a new node
whose children are the lighter and the heavier one in that order, until only one candidate pair is left; that
last created node is the root. Bits are read most significant bit first: a clear bit takes the left child and a
set bit the right child, a symbol of 0x100 ends the stream, and the walk returns whatever it produced when the
bits run out.

The rle stream is a sequence of control bytes: the low seven bits are a count, capped at what is left of the
declared unpacked size, and bit 0x80 turns the run into repetitions of the next byte, while a clear bit copies
that many literal bytes.

Decryption cuts the payload in two: with a stride above zero every byte from that stride on becomes the
exclusive or of itself and the byte one stride before it, which has already been decoded. Without a stride
every byte is keyed with `0x55`, except in versions below 200, where only the first byte is.

Because the stride keying rewrites the payload in place, an archive that uses both codecs decrypts the rle
output. The port follows the same order.

## Port notes and deviations

- An rle control byte with a count of zero cannot make progress in the reference; the port ends the stream
  there.
- A compressed entry whose record declares no unpacked size is reported with an unknown size, and its length is
  only known while decoding.
- The port bounds the number of tree nodes, which the reference would write past the end of its array.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/FrontWing/ArcVAV.cs` - `PakOpener.TryOpen`, `PakOpener.OpenEntry`,
  `PakOpener.DecryptEntry`, `PakOpener.UnpackRle`, `PakOpener.UnpackHuffman`, `PakOpener.BuildHuffmanTree`
