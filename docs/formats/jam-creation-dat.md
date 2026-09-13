# Jam Creation DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/JamCreation/ArcDAT.cs`, class `DatOpener`
- GARbro tag: `DAT/JAM`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This is a companion-index format. A volume must have the `dat` extension, must not itself be named
`00000000.dat`, and only opens when a sibling `00000000.dat` exists; that sibling holds the whole index,
and the volume contributes payload bytes plus the length its entries are validated against. Because the
index identifies entries by volume, several volumes can share one index.

The index header checks a version word at 0x14, which must be one, then describes five sections at 0x18
as offset and size pairs: a record table behind a count, a name offset table behind a count, a name pool,
and the same offset table and pool pair for archive names. Every section passes through a delta cipher
whose first byte is untouched and every later byte subtracts the running index plus the previous
decrypted byte, both reduced to eight bits. The reference decrypts each counted section from behind its
count word and only as far as the count announces, and decrypts the two pools in full; the port follows
exactly that.

Archive names map a volume's file name to an identifier. The record table is then walked in 24-byte
strides: a flag word of exactly 0x80000000 sets the directory name that prefixes the entries after it,
while any other record contributes an entry when its identifier matches this volume. Two quirks are kept:
a record that fails its placement check is skipped rather than rejecting the archive, and an empty
directory is treated as a failure. Directory names are joined with a forward slash.

Extraction gives packing priority over encryption, so an entry carrying both flags is only unzipped, and
an entry that is merely encrypted has the delta cipher applied to its bytes, which preserves its length.
Packed entries are zlib streams whose unpacked size is a declared bound, so they are marked as having an
inexact size.

## Support

| Capability | Status |
| --- | --- |
| Companion `00000000.dat` requirement | Supported |
| `dat` extension and the self-index rejection | Supported |
| Index version word | Supported |
| Five index sections with their counts | Supported |
| Delta cipher over counted sections and full pools | Supported |
| Archive name lookup by volume file name | Supported |
| Directory records and slash-joined names | Supported |
| Identifier filtering per volume | Supported |
| Placement failures skipped rather than fatal | Supported |
| CP932 names | Supported |
| zlib extraction for packed entries | Supported |
| Delta decryption for encrypted entries | Supported |
| Verbatim extraction otherwise | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a directory record with a plain and an encrypted entry, an entry belonging to
another volume, a packed entry, an unknown index version, and a volume whose name is missing from the
archive table.
