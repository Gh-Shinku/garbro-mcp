# GEM/vnengine AXR resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/VnEngine/ArcAXR.cs`, class `AxrOpener`
- GARBro tag: `AXR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Header

The archive starts with the `AXRe` marker and three words at 0x04, 0x08 and 0x0C.

| Field | Meaning |
| --- | --- |
| Key (0x04) | Seeds both ciphers, and is the second operand of the index size |
| Seed (0x08) | Mutated twice with the signature word to give `t` |
| Checksum (0x0C) | `checksum ^ MutateKey(t)` |

`MutateKey` mixes a 32-bit word with itself:

```text
key ^= (key & 0xFFF) << 17
return ~(key ^ (key << 18 | key >> 15))
```

The index size is `t ^ key`, where `t` is `MutateKey(MutateKey(seed ^ signature))`. The header checksum is an
exclusive-or of the eight bytes from 0x04 — the first one as it is, each following byte rotated right by its distance
from it — and the archive is rejected unless it equals the low byte of the stored checksum, or when the index is
smaller than eight bytes.

## Index

The index is read from 0x10 into a buffer rounded up to a whole number of words, and then decrypted word by word:

```text
for each word:
    key = MutateKey(key)
    value = word ^ key
    word = value
    key += value
```

The schedule adds the *decrypted* word, which is why the cipher is not its own inverse and why the same routine run
over a zero buffer produces the payload keystream. The reference writes a zero byte just past the index so that a name
running to the very end still terminates; the port does the same and scans the whole rounded buffer, matching the
reference's unbounded name search.

Records are then walked until the index end: an absolute payload offset, a stored size, and a CP932 name padded up to a
word boundary. An empty name ends the walk, every entry is placement-checked, and an archive without entries is
rejected.

## Extraction

The payload keystream is a 0x400-byte table built by running the index cipher over an empty buffer with the archive
key, whose words advance by their own value. Payload bytes are exclusive-ored with the table at their **absolute**
archive offset, wrapping every 0x400 bytes — the reference reads the underlying stream's position, which is the entry's
offset rather than a position inside the entry, so two entries at different offsets start at different places in the
table.

## Support

| Capability | Status |
| --- | --- |
| `AXRe` marker and the header checksum | Supported |
| Index size from the mutated seed and key | Supported |
| Word-wise index cipher and zero padding | Supported |
| Name records with absolute offsets and sizes | Supported |
| Empty name terminator and placement validation | Supported |
| Payload keystream table | Supported |
| Keystream exclusive-or at absolute offsets, wrapping at 0x400 | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover golden keystream words taken from the reference schedule, a cipher round trip, a two-entry
archive with nested paths, a payload longer than the keystream table, an entry that starts partway through the table, a
checksum mismatch, an index smaller than its header, an index that reaches past the archive, an entry outside the
archive, a foreign signature, and an index without entries. The `MutateKey` port was additionally cross-checked against
an independent transcription of the C# unsigned arithmetic on seven keys.
