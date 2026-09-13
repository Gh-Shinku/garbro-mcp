# YaneSDK engine DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/YaneSDK/ArcDAT.cs`, class `PakOpener`
- GARBro tag: `DAT/YaneSDK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The 16-bit record count at 0 is stored XORed with 0x8080 and read back as a signed value; the whole
index that follows at 2 is XOR-decrypted with the constant key 0x80. Records are 0x2c bytes wide: a
0x22-byte CP932 name, the size of the obfuscated prefix at +0x22, the stored size at +0x24, and the
data offset at +0x28.

GARbro requires every payload to start strictly behind the index and rejects out-of-range entries.
Entries are extracted by XORing their first `encrypted prefix` bytes with 0x80 and appending the
remaining bytes unchanged.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| XORed signed record count | Supported |
| Constant-key index decryption | Supported |
| Partial entry prefix decryption | Supported |
| Fully encrypted entries | Supported |
| Entry placement and data offset validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index decryption, partial and full prefix decryption, and data offset
rejection.
