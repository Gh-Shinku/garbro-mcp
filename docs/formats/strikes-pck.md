# Strikes resource archive (PCK/AVG)

## Reference and attribution

- GARbro reference: `ArcFormats/Strikes/ArcPCK.cs`, classes `PckOpener` and `RandomGenerator`
- GARbro tag: `PCK/AVG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The opener only accepts a file named `AVGDatas.pck`. The last 104 bytes hold a big endian seed and a hundred
byte header, both obfuscated with a lagged Fibonacci generator initialised from the seed:

```
end-104  int32     seed
end-100  bytes     header
```

The header passes a sanity check when the word built from its first four bytes, xored with `0xDEFD32D3`,
equals the big endian word at `0x18`. The big endian word at `0x1C` points at the index area.

Chunks are laid out around a four byte little endian header word. A chunk of `size` bytes is stored as the
big endian `size` word followed by the chunk body, and the reader shifts the first `skip * 4 - 4` body bytes
behind the header word, so the body is stored with a four byte gap holding the size word. The index chunk is
read with a skip of eight, which places its size word thirty two bytes into the chunk. When the size word has
bit 31 set, the chunk is an LZSS stream whose unpacked length is the low thirty one bits and the frame is
`0x1000` bytes starting at `0xFEE`.

The unpacked index is a sequence of directory blocks. Every block starts with twelve skipped bytes, a
big endian record count and then the records: a null terminated CP932 name of `0x28` bytes, the payload
offset, the stored size, an encryption flag and the unpacked size, all big endian except the unpacked size
which is little endian. Directories are named after their block number as four uppercase hexadecimal digits
and entries are joined behind them, so the archive is hierarchical.

Entries whose stored size differs from the unpacked size are LZSS compressed. Payload offset and stored size
locate the chunk: the reader looks for a big endian size word at offsets four to thirty two bytes into the
record, and takes the chunk path when that word plus four equals the stored size. The chunk body is shifted
behind its header word the same way as the index. Encrypted payloads are xored with the repeating little
endian key `0xC53A9A6C` over their first sixteen bytes, or with `0x6C9A3AC5` over the whole body when it is
shorter than sixteen bytes.

## Port notes and deviations

- The generator, the chunk reader and the LZSS stream follow the reference. The LZSS variant matches the
  shared `LzssStream` in `@garbro-mcp/codecs`, so the codec is reused.
- Directory counts are bounded at `0x40000` and a block that cannot be read in full is treated as a miss;
  the reference would read out of range and throw.
- The encryption method is applied to the stored chunk before decompression, exactly as in the reference.
- Archive creation and image decoding are out of scope.

## References

- `GARbro/ArcFormats/Strikes/ArcPCK.cs` - `PckOpener.TryOpen`, `PckOpener.OpenEntry`,
  `PckOpener.ReadChunk`, `PckOpener.DecryptData`, `PckOpener.LzssUnpack`, `RandomGenerator`
