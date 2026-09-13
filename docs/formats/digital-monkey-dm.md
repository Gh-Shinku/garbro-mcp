# Digital Monkey DM resource archive

## Reference and attribution

- GARBro reference: `Legacy/DigitalMonkey/ArcDM.cs`, class `DmOpener`
- GARBro tag: `DM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

`*.dm` archives start with a signed entry count and 0x2c-byte records. Each record has a CP932 name, unpacked size,
zlib stored size, and absolute payload offset. The archive name `image.dm` or `sound.dm` assigns the corresponding
resource category, as in GARBro. Every payload is zlib-compressed.

## Support

| Capability | Status |
| --- | --- |
| `.dm` extension and fixed index | Supported |
| CP932 paths and payload placement validation | Supported |
| zlib extraction | Supported |
| Archive creation | Unsupported |
