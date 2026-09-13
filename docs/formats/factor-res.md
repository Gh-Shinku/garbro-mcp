# Factor pack archives

## Reference and attribution

- GARBro reference: `Legacy/Factor/ArcRES.cs`, class `PackOpener`
- GARBro tag: `PACK/FACTOR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Recognition

This format has no signature. GARbro registers it with the *empty* extension and recognizes an archive by its name
alone: the base name has to be `pack` followed by a single digit.

Because the reference's extension list is the empty extension, only extensionless files reach `TryOpen`, and the port
keeps that: an archive that carries an extension is rejected, even though the opener still knows about names ending in
`.res`.

## Structure

The body is an unnamed walk. Every entry is preceded by its 32-bit size and followed by the next size:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Payload size |
| 0x04 | size | Payload |
| 0x04 + size | 4 | Next payload size, and so on to the end of the file |

Every range is placement-checked, zero-size entries are allowed, and a trailing field that does not hold a complete size
rejects the file.

Entry names come from the archive: the base name, a four digit index and the archive's own extension, which is empty by
construction. GARbro's alternative name table, which would read names out of `pack<N>.res`, is commented out in the
reference and is not reproduced.

## Extraction

Payloads are handed out as stored. The opener also knows a branch that inverts every byte of names ending in `.res`,
which the extension gate makes unreachable; the port keeps the branch so it behaves identically if a name ever carries
that extension.

## Support

| Capability | Status |
| --- | --- |
| Name-based detection through the `pack<digit>` pattern | Supported |
| Empty-extension requirement | Supported |
| Unnamed walk of size-prefixed payloads | Supported |
| Four-digit generated entry names | Supported |
| Zero-size entries and placement validation | Supported |
| `.res` inversion branch | Supported (unreachable) |
| Commented-out name table | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover two payloads, a zero-size entry, names that do not match, an archive with an extension, an
out-of-range payload and a truncated size field.
