# Eve resource archives (DAT/GM)

## Reference and attribution

- GARBro reference: `Legacy/Eve/ArcGM.cs`, classes `GmDatOpener` and `BprDecompressor`
- GARBro tag: `DAT/GM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the version string `GM1.0`, keeps a short header behind it and an index of length prefixed
records at a declared offset. Payloads may be compressed in one or two stages.

## Layout

```
"GM1.0\0" [padding to a four byte boundary after four extra bytes]
[u16 data offset] [u32 index size] [u32 index offset] [i32 entry count] [u16 key length] [u16 flags]
...
[i32 index offset + 0xC00]
[u32 offset] [u32 size] [u8 name length] [name]  (per entry)
```

The reference reads the version as a C string, then aligns the position with `((pos + 4) >> 2) << 2`, so the
header block starts four bytes plus padding behind the terminator. Entry offsets are relative to the data offset
word. The index size, the key length, the flags word and the key bytes themselves are read but never used: the
`DecryptIndex` helper in the reference is dead code, so the port does not decrypt an index. Names are shift-jis,
at most 255 bytes long, and every record is checked against the file size before it is listed.

## Payloads

A payload is compressed when its first byte is a letter between `B` and `E` and its second byte is `1`:

```
[u8 type] [u8 '1'] [u8 unknown] [u8 unknown] [i32 unpacked size] ... [LZSS stream from offset 10]
```

An `E` payload has the bytes at 17 and 23 as well as 19 and 24 swapped before the header is used, which the
reader reverses. The compressed stream is the twenty-five byte header from offset ten onwards followed by the
rest of the payload, which means the header itself carries the first fifteen bytes of the stream. It is a GARbro
LZSS stream with the default settings, decoded to the declared unpacked size; a stream that ends early leaves the
rest of the buffer zeroed, as in the reference.

When the decoded payload starts with `BPR01`, a second pass unpacks the bytes behind that marker:

```
[u8 control] [i32 count] [payload...]
```

A control byte of `0xFF` ends the stream. A control byte of one repeats the single byte that follows, and any
other control byte copies the next `count` bytes from the stream as they are. Other payloads are handed out as
they are stored.

## Port notes and deviations

- The archive has no extension list in the reference and none here; detection relies on the version string, the
  header and the first index record.
- GARbro writes nothing for this format, so archive creation stays out of scope.
- The BPR pass stops when the stream ends in the middle of a run, which mirrors the reference's `Read` returning
  fewer bytes than asked for.

## References

- `GARbro/Legacy/Eve/ArcGM.cs` - `GmDatOpener`, `DecryptIndex`, `BprDecompressor`
