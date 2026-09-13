# DAI system resource archives (PAC/DAI)

## Reference and attribution

- GARbro reference: `ArcFormats/DaiSystem/ArcPAC.cs`, class `PacOpener`
- GARbro tag: `PAC/DAI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the sixteen byte string `DAI_SYSTEM_01000`, keeps its index in plain text behind a
running subtraction and stores every payload behind the index.

## Layout

```
[u8 'DAI_SYSTEM_01000'] [u16 big endian frame count at 0x10] [u32 big endian index size at 0x12]
[index at 0x16] [payloads]
```

The count must be sane, which means greater than zero and below 0x40000. The index size is read as a big endian
word and the reader takes as many bytes as the file still holds, so a large index is simply cut short.

## Index

Every index byte is stored as `plain[i] = stored[i] - (i + 0x28)`, where `i` counts from the start of the index
and the key wraps at 256. Behind that subtraction the index is a sequence of records:

```
[name] [u8 ','] [u32 big endian offset] [u8 unused]
```

Names are CP932 and end at the first comma, which is also what tells the reader where the offset begins. A record
without a comma declines the archive. Offsets are absolute positions in the file and sizes are not stored: an
entry ends where the next one begins and the last one reaches to the end of the file. An offset that leaves the
file, or a distance that is not positive, declines the archive.

## Payload encoding

A payload that starts with `HA0` is protected. Its header is:

| Offset | Field |
| --- | --- |
| 0x00 | `HA0` marker |
| 0x03 | header length |
| 0x04 | big endian unpacked size, read but never used |
| 0x08 | pipeline pattern |

The payload itself starts at `0x10 + header length` and is walked through the pipeline pattern, four bytes of
method ids consumed from the most significant byte of the little endian word down. A pattern that runs out, and
a header that already covers the payload, leave the entry as it is.

| Method | Meaning |
| --- | --- |
| 0 | nothing |
| 2 | three interleaved streams are put back together in order |
| 3 | every byte is the sum of all bytes up to it |
| 4 | the bit ladder behind an unpacked-size header |
| other | the reference hands back the stored payload, header included |

The packed method is the same ladder the engine uses elsewhere: one control byte holds eight decisions taken
from its lowest bit, a clear bit is a literal byte and a set bit is a two byte back reference with a distance and
a count. A copy may overlap its own output.

## Port notes and deviations

- The reference reads the pattern even for payloads that are shorter than its header; the port only treats a
  payload as protected when the whole header is present, and hands back the stored payload otherwise.
- A copy that starts before the beginning of the unpacked payload or runs past its end is reported as an invalid
  archive instead of reading outside its buffer.
- Payload type classification beyond the `HA0` marker uses the shared file type detection and is not ported.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/DaiSystem/ArcPAC.cs` - `PacOpener.TryOpen`, `PacOpener.OpenEntry`,
  `PacOpener.DetectFileTypes`, `PacOpener.Decrypt2`, `PacOpener.Decrypt3`, `PacOpener.Unpack4`
