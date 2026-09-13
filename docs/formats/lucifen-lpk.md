# Lucifen system resource archive (LPK)

## Reference and attribution

- GARbro reference: `ArcFormats/Lucifen/ArcLPK.cs`, classes `LpkOpener`, `EncryptionScheme`,
  `LpkInfo` and `IndexReader`
- GARbro tag: `LPK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive starts with the `LPK1` signature and a little endian word whose top byte holds the flags
and whose low twenty four bits hold the index length. Both halves are obfuscated by the second key,
so the word is xored with it before use. The keys come from the scheme base key, xored and rotated by
the upper case base name of the archive without its extension: the first key mixes the name bytes back
to front, the second front to back, and every step rotates the keys by seven bits in opposite
directions.

```
+0  char[4]  "LPK1"
+4  uint32   (flags << 24) | index length, xored with key2
+8  byte[]   index
```

Flag bits: `0x01` addresses payloads in `0x800` byte units and stores the index length as a block
count, `0x02` is required and selects the supported index variant, `0x04` ciphers the first `0x100`
bytes of every entry, `0x08` records an unpacked size field per entry, `0x10` applies the content
cipher to whole entries. Patch archives set the flag bits they need but the reference clears the whole
content cipher bit for a `PATCH` archive before extracting.

The index is xored word by word with the second key while a pattern word rotates: the pattern rotates
left by four after every word and the key rotates right by the pattern. The layout is:

```
+0  int32    entry count
+4  byte     prefix length
+5  byte[]   prefix, prepended to every extracted entry
    byte     non zero selects four byte name offsets, otherwise two
    int32    letter table length
    byte[]   letter table
    byte[]   entry table
```

The letter table is a prefix tree. A node is a byte count followed by that many `letter, offset` pairs;
the offset is a signed word or a signed dword, relative to the byte after the offset field. A non zero
letter descends into the child node and appends the letter to the current name; a zero letter is a
terminal whose value is an entry number instead of an offset. Entry names are therefore stored once per
shared prefix, and the reader records entries in traversal order.

Entry records are thirteen bytes when the unpacked size field is present and nine otherwise, plus a
leading flag byte whenever the record size is odd:

```
+0  byte     flag
+1  uint32   payload offset, in block units when bit 0x01 is set
+5  uint32   stored size
+9  uint32   unpacked size, zero when the entry is stored
```

The archive is not hierarchical even though names can contain separators.

## Extraction

Packed entries are a shared `LzssStream` whose output length is the recorded unpacked size. The
extracted bytes then pass the content cipher when bit `0x10` is set: every byte is xored with `0x5D`
and nibble rotated right by four. Bit `0x04` applies the entry cipher to the first `0x100` bytes, which
is the same rotating key construction as the index but with the rotations mirrored: the pattern rotates
right and the key rotates left. The index prefix, when present, is prepended to the result. A zero
sized entry extracts to an empty stream, prefix or not.

## Port notes and deviations

- Only the built in `Default` scheme is implemented. The reference also consults a game scheme table and
  can import per-file keys from a sibling `SCRIPT.LPK`; both require user supplied data and are not
  ported.
- The reference throws out of its index reader for malformed trees and lets `TryOpen` swallow the error
  on the first attempt. The port declines instead, and the archive fails to open.
- Payload placement is validated; the reference leaves unplaced entries to fail during extraction.
- Archive creation and image decoding are out of scope.

## References

- `GARbro/ArcFormats/Lucifen/ArcLPK.cs` - `LpkOpener.TryOpen`, `LpkOpener.Open`,
  `LpkOpener.OpenEntry`, `EncryptionScheme.DecryptContent`, `EncryptionScheme.DecryptIndex`,
  `EncryptionScheme.DecryptEntry`, `IndexReader.Read`, `IndexReader.TraverseIndex`,
  `IndexReader.AddEntry`
