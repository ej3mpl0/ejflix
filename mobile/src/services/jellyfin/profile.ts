/**
 * Jellyfin `DeviceProfile`s for Android (ExoPlayer) and iOS (AVPlayer) playback plus the track picker used to honour
 * the audio / subtitle language settings. Pure module (vitest-friendly).
 */
import { matchesLang } from "./languages";
import type { JellyfinMediaStream } from "./playback.pure";

/**
 * Audio codecs the device plays without help. AC3 / EAC3 / DTS / TrueHD are left out on
 * purpose: the server then transcodes the audio while copying the video stream.
 */
export const DIRECT_AUDIO = "aac,mp3,opus,vorbis,flac,alac,pcm";

export const MAX_STREAMING_BITRATE = 120_000_000;

export const ANDROID_DEVICE_PROFILE = {
  Name: "ejFlix Android",
  MaxStreamingBitrate: MAX_STREAMING_BITRATE,
  MaxStaticBitrate: MAX_STREAMING_BITRATE,
  MusicStreamingTranscodingBitrate: 384_000,
  DirectPlayProfiles: [
    { Container: "mp4,m4v,mov", Type: "Video", VideoCodec: "h264,hevc,av1,vp9,mpeg4", AudioCodec: DIRECT_AUDIO },
    { Container: "mkv,webm", Type: "Video", VideoCodec: "h264,hevc,av1,vp9,vp8", AudioCodec: DIRECT_AUDIO },
    { Container: "ts,mpegts,m2ts", Type: "Video", VideoCodec: "h264,hevc", AudioCodec: DIRECT_AUDIO },
    { Container: "mp3,flac,aac,m4a,ogg,opus,wav", Type: "Audio" },
  ],
  TranscodingProfiles: [
    {
      Container: "ts",
      Type: "Video",
      VideoCodec: "h264,hevc",
      AudioCodec: "aac,mp3",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "2",
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: "mp4",
      Type: "Video",
      VideoCodec: "h264,hevc",
      AudioCodec: "aac",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "2",
    },
    { Container: "mp3", Type: "Audio", AudioCodec: "mp3", Protocol: "http" },
  ],
  CodecProfiles: [
    {
      Type: "Video",
      Codec: "hevc",
      Conditions: [
        { Condition: "EqualsAny", Property: "VideoProfile", Value: "main|main 10", IsRequired: false },
        { Condition: "LessThanEqual", Property: "VideoLevel", Value: "183", IsRequired: false },
      ],
    },
    {
      Type: "Video",
      Codec: "h264",
      Conditions: [
        {
          Condition: "EqualsAny",
          Property: "VideoProfile",
          Value: "high|main|baseline|constrained baseline|high 10",
          IsRequired: false,
        },
        { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52", IsRequired: false },
      ],
    },
    {
      Type: "Video",
      Conditions: [
        {
          Condition: "EqualsAny",
          Property: "VideoRangeType",
          Value: "SDR|HDR10|HLG|HDR10Plus|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR",
          IsRequired: false,
        },
      ],
    },
    {
      Type: "VideoAudio",
      Conditions: [{ Condition: "LessThanEqual", Property: "AudioChannels", Value: "8", IsRequired: false }],
    },
  ],
  SubtitleProfiles: [
    { Format: "srt", Method: "Embed" },
    { Format: "subrip", Method: "Embed" },
    { Format: "vtt", Method: "Embed" },
    { Format: "webvtt", Method: "Embed" },
    { Format: "ass", Method: "Embed" },
    { Format: "ssa", Method: "Embed" },
    { Format: "pgs", Method: "Embed" },
    { Format: "pgssub", Method: "Embed" },
    { Format: "dvbsub", Method: "Embed" },
    { Format: "dvdsub", Method: "Embed" },
    { Format: "ttml", Method: "Embed" },
    { Format: "vtt", Method: "Hls" },
    { Format: "ass", Method: "Encode" },
    { Format: "ssa", Method: "Encode" },
    { Format: "pgssub", Method: "Encode" },
    { Format: "dvdsub", Method: "Encode" },
    { Format: "dvbsub", Method: "Encode" },
  ],
} as const;

/**
 * Audio codecs AVPlayer decodes itself. Unlike ExoPlayer it handles AC3 / EAC3 (Dolby
 * Digital / Plus); DTS, TrueHD, Opus and Vorbis are transcoded by the server.
 */
export const IOS_DIRECT_AUDIO = "aac,mp3,alac,flac,ac3,eac3,pcm";

/**
 * AVPlayer only opens MP4 / MOV files and HLS: no MKV, WebM or raw MPEG-TS, and no VP8 /
 * VP9 / AV1 in them. Everything else reaches it as HLS with fMP4 segments (the only way
 * Apple accepts HEVC in HLS), with a TS / H.264 profile after it for older servers.
 */
export const IOS_DEVICE_PROFILE = {
  Name: "ejFlix iOS",
  MaxStreamingBitrate: MAX_STREAMING_BITRATE,
  MaxStaticBitrate: MAX_STREAMING_BITRATE,
  MusicStreamingTranscodingBitrate: 384_000,
  DirectPlayProfiles: [
    { Container: "mp4,m4v,mov", Type: "Video", VideoCodec: "h264,hevc", AudioCodec: IOS_DIRECT_AUDIO },
    { Container: "mp3,aac,m4a,flac,wav", Type: "Audio" },
  ],
  TranscodingProfiles: [
    {
      Container: "mp4",
      Type: "Video",
      VideoCodec: "hevc,h264",
      AudioCodec: "aac,ac3,eac3",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "6",
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: "ts",
      Type: "Video",
      VideoCodec: "h264",
      AudioCodec: "aac,mp3",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "2",
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
    { Container: "aac", Type: "Audio", AudioCodec: "aac", Protocol: "http" },
  ],
  CodecProfiles: [
    {
      Type: "Video",
      Codec: "hevc",
      Conditions: [
        { Condition: "EqualsAny", Property: "VideoProfile", Value: "main|main 10", IsRequired: false },
        { Condition: "LessThanEqual", Property: "VideoLevel", Value: "183", IsRequired: false },
      ],
    },
    {
      Type: "Video",
      Codec: "h264",
      Conditions: [
        {
          Condition: "EqualsAny",
          Property: "VideoProfile",
          Value: "high|main|baseline|constrained baseline",
          IsRequired: false,
        },
        { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52", IsRequired: false },
      ],
    },
    {
      Type: "Video",
      Conditions: [
        {
          Condition: "EqualsAny",
          Property: "VideoRangeType",
          Value: "SDR|HDR10|HLG|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR",
          IsRequired: false,
        },
      ],
    },
    {
      Type: "VideoAudio",
      Conditions: [{ Condition: "LessThanEqual", Property: "AudioChannels", Value: "6", IsRequired: false }],
    },
  ],
  // AVPlayer shows WebVTT delivered inside HLS and text tracks muxed into MP4; any
  // other format (SRT/ASS in MKV, PGS, DVD) is burned into the video by the server.
  SubtitleProfiles: [
    { Format: "vtt", Method: "Hls" },
    { Format: "webvtt", Method: "Hls" },
    { Format: "mov_text", Method: "Embed" },
    { Format: "srt", Method: "Encode" },
    { Format: "subrip", Method: "Encode" },
    { Format: "ass", Method: "Encode" },
    { Format: "ssa", Method: "Encode" },
    { Format: "pgssub", Method: "Encode" },
    { Format: "dvdsub", Method: "Encode" },
    { Format: "dvbsub", Method: "Encode" },
  ],
} as const;

export type DeviceProfile = typeof ANDROID_DEVICE_PROFILE | typeof IOS_DEVICE_PROFILE;

/** The profile for the platform the app runs on (`Platform.OS`). */
export function deviceProfileFor(os: string): DeviceProfile {
  return os === "ios" ? IOS_DEVICE_PROFILE : ANDROID_DEVICE_PROFILE;
}

export type StreamKind = "Audio" | "Subtitle";

/**
 * Index of the first `kind` stream in language `lang` ("" = file default → undefined).
 * Among several matches a default track wins for audio and a non-forced one for subtitles.
 */
export function pickStreamIndex(
  mediaStreams: JellyfinMediaStream[],
  kind: StreamKind,
  lang: string,
): number | undefined {
  const code = lang.trim().toLowerCase();
  if (!code || code === "off") return undefined;
  const matches = mediaStreams.filter((s) => s.Type === kind && matchesLang(s.Language, code));
  if (matches.length === 0) return undefined;
  const preferred =
    kind === "Subtitle" ? matches.find((s) => !s.IsForced) : matches.find((s) => s.IsDefault);
  return (preferred ?? matches[0]).Index;
}
