# KAAS engine PD resource archive (PD/KAAS)

## Reference and attribution

- GARbro reference: `ArcFormats/Kaas/ArcKAAS.cs`, class `PdOpener` and its index decryptors
- GARbro tag: `PD/KAAS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  byte      index descriptor offset, greater than two and inside the file
0x01  byte      index key
index uint16    entry count, masked with 0x0FFF
      bytes     twelve more descriptor bytes
      records   one record of eight bytes per entry: uint32 offset, uint32 stored size
data            payloads; record offsets are absolute
```

The index is protected per byte by one of two schemes, both of which subtract a value derived from the byte
position and the file key:

- the discovery scheme uses `((k * 0x6B) % (k / 2 + 1)) + key * 0x3B * (k + 11) * (k % (k + 17))`
- the old scheme uses `9 - (k & 7) * (k + 5) * key * 0x77`

where `k` is the index position plus fourteen. Both are tried in reference order and the first one that
yields a valid index wins. A record offset has to stay behind the index and inside the file, records with a
zero size are skipped, and every payload has to fit inside the file. Frames are named `{base}#{index}` with
a four digit record number and typed as images.

## Port notes and deviations

- The reference reads the index once per decryptor and catches all faults a wrong decryptor produces; this
  port decrypts a copy per scheme and treats a failed validation as a miss.
- Payloads are exposed as stored. The reference unpacks overlays through `OpenImage`, which is out of scope.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Kaas/ArcKAAS.cs` - `PdOpener.TryOpen`, `PdOpener.ReadIndex`,
  `DiscoveryDecryptor.Decrypt`, `OldDecryptor.Decrypt`
