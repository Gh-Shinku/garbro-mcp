# RealLive engine audio format (`NWA`)

Reference: GARbro `ArcFormats/RealLive/AudioNWA.cs`, classes `NwaAudio`, `NwaMetaData` and `NwaDecoder`,
together with `LsbBitStream` from `ArcFormats/BitStream.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The signature of the RealLive engine and of the games built on it. A sound stands as a head of `0x28` places,

## Head

| place | word |
| --- | --- |

## Deviations from the reference

## Verification
