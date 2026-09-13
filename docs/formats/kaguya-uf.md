# Atelier Kaguya UF01 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcUF.cs`, class `UfOpener`
- GARBro tag: `ARC/UF01`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `UF01` signature and a 32-bit index offset at 0x04. Payload offsets are not stored in the
index: the reference reconstructs them by walking the records from offset eight, adding a name length plus ten bytes per
record followed by that record's stored size — and a further four bytes when the entry is packed, because packed payloads
keep their unpacked size in front of the stream. That walk matches the front of the file, which interleaves each record
with its payload, while a copy of the record table sits behind the index offset and runs to the end of the file.

Records hold a 32-bit name length, the name with every byte inverted, a 16-bit flags word and the stored size. Names are
decoded as CP932 and have leading path separators trimmed. A flags value of one marks the entry as packed. The port
probes the unpacked size while parsing the index so listing and extraction agree, and rejects a packed record whose
stored extent cannot hold that prefix.

## Extraction

Stored payloads are plain byte ranges. Packed payloads are decoded by the reference's private window decoder: a
most-significant-bit-first control bit selects between an eight-bit literal and a match whose twelve-bit offset indexes
the 0x1000-byte window absolutely while its four-bit count adds two. The write position starts at one and only decides
where decoded bytes are stored; the copy reads the window by absolute index, so a match can re-read the bytes it has
just written. A match that would run past the declared unpacked size raises an invalid-archive error. A packed entry
whose declared unpacked size is zero yields an empty stream, as it does in the reference.

## Support

| Capability | Status |
| --- | --- |
| `UF01` signature and index offset | Supported |
| Sequential record walk with derived payload offsets | Supported |
| Inverted CP932 names | Supported |
| Leading separator trimming | Supported |
| Packed flag with four-byte unpacked size prefix | Supported |
| MSB bit stream frame decoder | Supported |
| Empty packed payloads | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the decoder (a literal and an overlapping frame match), stored entries, nested names, a packed
entry, a foreign signature, an out-of-range index offset and an implausible name length.
