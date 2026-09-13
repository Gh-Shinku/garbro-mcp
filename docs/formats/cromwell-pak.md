# cromwell graphic PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cromwell/ArcPAK.cs`, class `GraphicPakOpener`
- GARBro tag: `PAK/cromwell`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with either `Graphic PackData` or `Voice PackData. `; both share one layout. A record count follows
at 0x10, then 0x14-byte records starting at 0x14: a 0xC-byte CP932 name, an absolute payload offset that must lie inside
the file, and the declared unpacked size. Records whose names are empty or whitespace only are rejected.

Every entry is stored as a zlib stream, so the reference never uses the record's size field as a stored extent. Instead
it back-fills each entry's stored size from the next record's offset, with the last entry running to the end of the file.
The port checks that the resulting extent is inside the file and falls back to the bytes remaining after the offset when
the offsets are not ascending, which is what the reference's clamped stream would see.

The reference types payloads by signature: `Graphic PackData` archives hold images and `Voice PackData. ` archives hold
audio. A graphic archive whose file is itself named `VOICE` (case-insensitive, extension ignored) is retyped as audio,
which is how the reference handles a voice pack that reuses the graphic signature. Payload types are exposed through the
entry metadata.

## Extraction

Every payload is inflated from a raw zlib stream over its stored extent. Because the reference streams the decoder to
the end of the payload rather than trusting the declared size, the port reports the actual decoded byte count.

## Support

| Capability | Status |
| --- | --- |
| `Graphic PackData` and `Voice PackData. ` signatures | Supported |
| Record count at 0x10 | Supported |
| 0x14 records with 0xC-byte CP932 names | Supported |
| Absolute payload offsets | Supported |
| Next-offset stored extents with EOF tail | Supported |
| `VOICE`-named graphic archive override | Supported |
| Image and audio typing | Supported |
| Zlib extraction | Supported |
| Whitespace and out-of-range record rejection | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover graphic and voice archives, the `VOICE` filename override, a foreign signature, an out-of-range
payload offset and a nameless record.
