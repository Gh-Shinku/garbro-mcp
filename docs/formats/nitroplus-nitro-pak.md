# Nitro+ resource archives (PAK/NITRO+)

## Reference and attribution

- GARBro reference: `ArcFormats/NitroPlus/ArcNitro.cs`, class `PakOpener` (tag `PAK/NITRO+`)
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

This is the older of the two Nitro+ `PAK` families; `PAK/MAGI` is a different container handled by its own
module. The file starts with a version word, either two or three, and every version keeps a compressed index at
offset 0x114 behind a small header. There is no other signature, so detection validates the version specific
header, the compressed index and every record before accepting a file.

## Key derivation

Version three derives a 32 bit key from a name with a small polynomial that runs over the signed bytes of the
name in 32 bit arithmetic:

```
key = key * 0x89 + (signed byte)   (truncated to 32 bits)
```

The header uses the key of the game name, while each record and each unpacked payload use the key of the entry
name.

## Version 2

```
[u32 version = 2] [i32 entry count] [i32 unpacked index size] [u32 packed index size]
[zlib index, packed index size bytes] [entry payloads]
```

The index is a zlib stream. Each record holds

```
[i32 name length] [name] [u32 offset] [u32 unpacked size] [u32 stored size] [i32 packed flag] [u32 packed size]
```

Names are CP932 and at least one byte long. Offsets are relative to the payload area, which starts right after
the compressed index at `0x114 + packed index size`. A packed entry stores a zlib stream and takes its stored
size from the last field, which replaces the stored size field; a plain entry stores its bytes as they are.

## Version 3

```
[u32 version = 3] [0x100 byte game name] [u32 size mask] [u32 unpacked] [u32 entry count] [u32 index size]
[zlib index, index size bytes] [entry payloads]
```

The game name is a NUL terminated printable string of at most sixteen bytes; every byte before the terminator
must stay between 0x20 and 0x7F. The size mask field must read 0x64 and doubles as the xor mask of the index
size, while the entry count and an unused unpacked size are xored with the key of the game name.

Each record holds

```
[i32 name length] [name]
[u32 offset ^ key] [u32 unpacked size ^ key] [u32 unused ^ key] [u32 packed flag ^ key] [u32 packed size ^ key]
```

Offsets are relative to `0x114 + index size`, and the key is derived from the record name. Packed entries are
zlib streams. Unpacked entries are stored as they are except that the first `min (size, 0x10)` bytes are xored
with the key, which the reader rotates right by one byte after every step, so the first four bytes cycle through
the key bytes and the pattern repeats every four bytes.

## Port notes and deviations

- The reference grows its name buffer for version two names of any length and then rejects names longer than the
  compressed index; the port bounds a name by the remaining index bytes, which rejects the same files.
- Version three names are limited to the 0x100 byte header field, as in the reference.
- Payload decompression passes the declared unpacked size to the zlib decoder, so a stream that unpacks to a
  different length fails with `INVALID_ARCHIVE` instead of returning short or padded data.
- The reference exposes a separate unpacked size for plain version two entries; the port reports the stored size
  as the entry size and keeps the declared unpacked size in the entry metadata.
- The reference's view truncates reads that leave the file. The port truncates the encrypted prefix of a version
  three entry the same way, while a record that leaves the file declines the archive, as `CheckPlacement` does.

## References

- `GARbro/ArcFormats/NitroPlus/ArcNitro.cs` - `PakOpener`, `PakEntry`, `NitroPak`, `GetKey`, `OpenPakV2`,
  `OpenPakV3`, `OpenV3Entry`
