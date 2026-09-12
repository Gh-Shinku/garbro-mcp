# Favorite View Point BIN

## Reference and attribution

- GARbro reference: `ArcFormats/Favorite/ArcBIN.cs`, class `Bin2Opener`
- GARbro tag: `BIN/FVP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on the observed structure and GARbro
behavior. It is distinct from the older `BIN/ACPXPK` implementation in
`ArcFormats/Favorite/ArcFVP.cs`.

## Structure

The signatureless header contains a little-endian signed entry count followed by the byte length of
the filename table. Each 12-byte index record stores an offset into that CP932, null-terminated name
table, a data offset, and a stored size. Entry data is neither compressed nor encrypted.

For archives other than `voice.bin` and `bgm.bin`, GARbro examines entry signatures and appends the
preferred extension for a recognized resource. This implementation currently recognizes the
Favorite HZC `hzc1` signature and RIFF/WAVE audio. `voice.bin` and `bgm.bin` entries are marked as
audio without changing their filenames.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| CP932 filename table | Supported |
| Entry listing and extraction | Supported |
| RIFF/WAVE and HZC extension inference | Supported |
| Full GARbro resource-catalog inference | Unsupported |
| Archive creation | Unsupported |

The tracked synthetic tests are safe to run in every environment. The real differential test runs
only when both `data/favorite/se_sys.bin` and its GARbro output directory
`data/favorite/se_sys/` exist locally. The entire `data/` directory is excluded from Git.
