# Mokopro compressed files (DAT/NNNN)

## Reference and attribution

- GARBro reference: `ArcFormats/MokoPro/CompressedFile.cs`, classes `NNNNOpener` and `MokoCrypt`
- GARBro tag: `DAT/NNNN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A file of this kind is not a container of several resources but a single compressed payload, so the archive view
has exactly one entry that carries the name of the file itself.

## Layout

```
[u32 'NNNN'] [i32 unpacked size] [encrypted LZSS stream]
```

The unpacked size must be positive; the reference rejects a file whose header does not start with `NNNN` or
declares a non positive size. Everything behind the eight byte header is encrypted, the header itself is not.

## Decryption

`MokoCrypt.Decrypt` walks the payload backwards and mixes every byte with its successor and with the two key
bytes of `DefaultKey` (`1` and `0x23`):

```
for i = length - 2 down to 0:
    data[i]     ^= key[1] ^ data[i + 1]
    data[i + 1] ^= key[0] ^ data[i]
```

The second statement uses the byte the first one just wrote. Since the pass writes both members of each pair, the
decrypted byte at position `i + 1` is always `cipher[i] ^ key[0] ^ key[1]` for every position after the first,
which is what the port's tests use to build encrypted fixtures without duplicating the loop.

## Decompression

The decrypted payload is a GARbro LZSS stream that the reference opens with `LzssStream` and a ring buffer
filled with spaces (`FrameFill = 0x20`); every other setting is the GARbro default. The port decodes with the
same window fill and the declared unpacked size, and keeps whatever a stream that ends early produced, which is
what the reference's stream wrapper does when it is read to the end.

## Port notes and deviations

- The bitmap and audio formats in the same reference file (`BMP/NNNN` and `OGG/NNNN`) wrap the same
  `MokoCrypt` container for images and sound; they are image and audio formats and out of scope here.
- The reference always lists the entry once the header parses, even when the packed payload is garbage, and the
  port does the same; a decoding failure surfaces when the entry is opened.

## References

- `GARbro/ArcFormats/MokoPro/CompressedFile.cs` - `NNNNOpener`, `MokoCrypt` (`DefaultKey`, `Decrypt`,
  `UnpackStream`, `UnpackBytes`)
