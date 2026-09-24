import { describe, expect, it } from "vitest";
import { langAliases, matchesLang } from "../jellyfin/languages";
import { PlaybackError } from "../events";
import { parseMediaStreams, parsePlaybackInfo, playbackErrorKey, playbackErrorMessage } from "../jellyfin/playback.pure";
import {
  ANDROID_DEVICE_PROFILE,
  DIRECT_AUDIO,
  IOS_DEVICE_PROFILE,
  deviceProfileFor,
  pickStreamIndex,
} from "../jellyfin/profile";

const options = {
  itemId: "item-00000001",
  serverUrl: "https://jf.example/",
  token: "tok",
  deviceId: "dev",
};

const streams = [
  { Index: 0, Type: "Video", Codec: "hevc" },
  { Index: 1, Type: "Audio", Codec: "eac3", Language: "eng", IsDefault: true, DisplayTitle: "English" },
  { Index: 2, Type: "Audio", Codec: "aac", Language: "spa", DisplayTitle: "Español" },
  { Index: 3, Type: "Subtitle", Codec: "subrip", Language: "spa", IsForced: true },
  { Index: 4, Type: "Subtitle", Codec: "subrip", Language: "spa", IsExternal: true },
  { Index: 5, Type: "Subtitle", Codec: "pgssub", Language: "es-ES" },
  { Index: 6, Type: "Subtitle", Codec: "subrip", Language: "eng" },
];

const directFixture = {
  PlaySessionId: "ps-1",
  MediaSources: [
    {
      Id: "src-a",
      Container: "mkv",
      ETag: "etag1",
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      SupportsTranscoding: true,
      DefaultAudioStreamIndex: 1,
      DefaultSubtitleStreamIndex: -1,
      MediaStreams: streams,
      TranscodingUrl: "/videos/item-00000001/master.m3u8?x=1",
    },
    { Id: "src-b", Container: "mp4", SupportsDirectPlay: true, MediaStreams: [] },
  ],
};

const transcodeFixture = {
  PlaySessionId: "ps-2",
  MediaSources: [
    {
      Id: "src-a",
      Container: "mkv",
      SupportsDirectPlay: false,
      SupportsDirectStream: false,
      SupportsTranscoding: true,
      TranscodingUrl: "/videos/item-00000001/master.m3u8?DeviceId=dev&MediaSourceId=src-a&PlaySessionId=ps-2&api_key=tok",
      TranscodingSubProtocol: "hls",
      TranscodingContainer: "ts",
      DefaultAudioStreamIndex: 2,
      DefaultSubtitleStreamIndex: 4,
      MediaStreams: streams,
    },
  ],
};

describe("parsePlaybackInfo", () => {
  it("builds a static stream URL for direct play", () => {
    const out = parsePlaybackInfo(directFixture, options);
    expect(out.playMethod).toBe("DirectPlay");
    expect(out.contentType).toBe("progressive");
    expect(out.transcoding).toBe(false);
    expect(out.container).toBe("mkv");
    expect(out.mediaSourceId).toBe("src-a");
    expect(out.playSessionId).toBe("ps-1");
    expect(out.url).toBe(
      "https://jf.example/Videos/item-00000001/stream.mkv?static=true&MediaSourceId=src-a&DeviceId=dev&api_key=tok&PlaySessionId=ps-1&Tag=etag1",
    );
    expect(out.headers).toEqual({ "X-Emby-Token": "tok" });
    expect(out.audioStreamIndex).toBe(1);
    expect(out.subtitleStreamIndex).toBe(-1);
    expect(out.mediaStreams).toHaveLength(7);
    expect(out.mediaStreams[1]).toEqual({
      Index: 1,
      Type: "Audio",
      Codec: "eac3",
      Language: "eng",
      DisplayTitle: "English",
      Title: null,
      IsDefault: true,
      IsExternal: false,
      IsForced: false,
      Channels: null,
      Width: null,
      Height: null,
    });
  });

  it("honours the requested media source and reports DirectStream", () => {
    const out = parsePlaybackInfo(directFixture, { ...options, requestedMediaSourceId: "src-b" });
    expect(out.mediaSourceId).toBe("src-b");
    expect(out.container).toBe("mp4");
    expect(out.url).toContain("/stream.mp4?static=true&MediaSourceId=src-b&");
    expect(out.url).not.toContain("Tag=");
    const remux = parsePlaybackInfo(
      { MediaSources: [{ Id: "s", Container: "ts", SupportsDirectPlay: false, SupportsDirectStream: true }] },
      options,
    );
    expect(remux.playMethod).toBe("DirectStream");
    expect(remux.audioStreamIndex).toBeUndefined();
  });

  it("uses the transcoding URL for HLS", () => {
    const out = parsePlaybackInfo(transcodeFixture, options);
    expect(out.playMethod).toBe("Transcode");
    expect(out.contentType).toBe("hls");
    expect(out.transcoding).toBe(true);
    expect(out.container).toBe("ts");
    expect(out.url).toBe(
      "https://jf.example/videos/item-00000001/master.m3u8?DeviceId=dev&MediaSourceId=src-a&PlaySessionId=ps-2&api_key=tok",
    );
    expect(out.audioStreamIndex).toBe(2);
    expect(out.subtitleStreamIndex).toBe(4);
    const http = parsePlaybackInfo(
      { MediaSources: [{ Id: "s", TranscodingUrl: "/x.mp4", TranscodingSubProtocol: "http" }] },
      options,
    );
    expect(http.contentType).toBe("auto");
  });

  it("throws Spanish errors", () => {
    expect(() => parsePlaybackInfo({ ErrorCode: "NoCompatibleStream" }, options)).toThrow(
      "El servidor no puede reproducir este archivo",
    );
    expect(() => parsePlaybackInfo({ MediaSources: [] }, options)).toThrow("El servidor no puede reproducir este archivo");
    expect(() => parsePlaybackInfo({ MediaSources: [{ Id: "s" }] }, options)).toThrow(
      "El servidor no puede reproducir este archivo",
    );
    expect(() => parsePlaybackInfo(null, options)).toThrow("Respuesta inválida del servidor");
    expect(playbackErrorMessage("NotAllowed")).toBe("El servidor no permite reproducir este archivo");
    expect(playbackErrorMessage("Weird")).toBe("No se puede reproducir (Weird)");
  });

  it("tags known failures with a translation key", () => {
    const keyOf = (response: unknown) => {
      try {
        parsePlaybackInfo(response, options);
      } catch (error) {
        return error instanceof PlaybackError ? error.key : null;
      }
      return "no error";
    };
    expect(keyOf({ ErrorCode: "NoCompatibleStream" })).toBe("playErrServerCannotPlay");
    expect(keyOf({ ErrorCode: "NotAllowed" })).toBe("playErrNotAllowed");
    expect(keyOf({ ErrorCode: "Weird" })).toBe("playErrServerCode");
    expect(keyOf({ MediaSources: [] })).toBe("playErrServerCannotPlay");
    expect(keyOf({ MediaSources: [{ Id: "s" }] })).toBe("playErrServerCannotPlay");
    expect(keyOf(null)).toBe("playErrBadResponse");
    expect(playbackErrorKey("RateLimitExceeded")).toBe("playErrRateLimit");
    expect(playbackErrorKey("Weird")).toBe("playErrServerCode");
    // The unknown code travels as the detail shown under the sentence.
    try {
      parsePlaybackInfo({ ErrorCode: "Weird" }, options);
    } catch (error) {
      expect(error instanceof PlaybackError ? error.detail : null).toBe("Weird");
    }
  });

  it("drops streams without an index", () => {
    expect(parseMediaStreams([{ Type: "Audio" }, { Index: 1 }, null])).toEqual([]);
  });
});

describe("pickStreamIndex", () => {
  const parsed = parseMediaStreams(streams);
  it("returns undefined for the file default and off", () => {
    expect(pickStreamIndex(parsed, "Audio", "")).toBeUndefined();
    expect(pickStreamIndex(parsed, "Subtitle", "off")).toBeUndefined();
    expect(pickStreamIndex(parsed, "Audio", "jpn")).toBeUndefined();
  });
  it("matches aliases and prefers default audio / non-forced subtitles", () => {
    expect(pickStreamIndex(parsed, "Audio", "spa")).toBe(2);
    expect(pickStreamIndex(parsed, "Audio", "eng")).toBe(1);
    expect(pickStreamIndex(parsed, "Subtitle", "spa")).toBe(4);
    expect(pickStreamIndex(parsed, "Subtitle", "eng")).toBe(6);
  });
});

describe("languages", () => {
  it("lists every spelling like player.rs", () => {
    expect(langAliases("spa")).toEqual(["spa", "es"]);
    expect(langAliases("deu")).toEqual(["deu", "ger", "de"]);
    expect(langAliases("xyz")).toEqual(["xyz"]);
    expect(langAliases("")).toEqual([]);
    expect(matchesLang("GER", "deu")).toBe(true);
    expect(matchesLang("pt-BR", "por")).toBe(true);
    expect(matchesLang("fre", "eng")).toBe(false);
    expect(matchesLang(null, "eng")).toBe(false);
  });
});

describe("ANDROID_DEVICE_PROFILE", () => {
  it("leaves AC3/EAC3/DTS/TrueHD out of direct play so audio gets transcoded", () => {
    expect(DIRECT_AUDIO.split(",")).not.toContain("ac3");
    expect(DIRECT_AUDIO.split(",")).not.toContain("eac3");
    expect(DIRECT_AUDIO.split(",")).not.toContain("dts");
    expect(DIRECT_AUDIO.split(",")).not.toContain("truehd");
    expect(ANDROID_DEVICE_PROFILE.Name).toBe("ejFlix Android");
    expect(ANDROID_DEVICE_PROFILE.MaxStreamingBitrate).toBe(120_000_000);
    expect(ANDROID_DEVICE_PROFILE.TranscodingProfiles[0]).toMatchObject({ Container: "ts", Protocol: "hls", MaxAudioChannels: "2" });
    expect(ANDROID_DEVICE_PROFILE.SubtitleProfiles).toContainEqual({ Format: "vtt", Method: "Hls" });
    expect(JSON.parse(JSON.stringify(ANDROID_DEVICE_PROFILE))).toEqual(ANDROID_DEVICE_PROFILE);
  });
});

describe("IOS_DEVICE_PROFILE", () => {
  const containers = IOS_DEVICE_PROFILE.DirectPlayProfiles.filter((p) => p.Type === "Video").flatMap((p) =>
    p.Container.split(","),
  );

  it("only direct-plays what AVPlayer opens", () => {
    expect(IOS_DEVICE_PROFILE.Name).toBe("ejFlix iOS");
    expect(containers).toEqual(["mp4", "m4v", "mov"]);
    for (const bad of ["mkv", "webm", "ts", "mpegts", "m2ts"]) expect(containers).not.toContain(bad);
    const codecs = IOS_DEVICE_PROFILE.DirectPlayProfiles[0].VideoCodec.split(",");
    for (const bad of ["vp8", "vp9", "av1"]) expect(codecs).not.toContain(bad);
  });

  it("transcodes to HLS with fMP4 first (HEVC in HLS)", () => {
    expect(IOS_DEVICE_PROFILE.TranscodingProfiles[0]).toMatchObject({ Container: "mp4", Protocol: "hls" });
    expect(IOS_DEVICE_PROFILE.TranscodingProfiles[1]).toMatchObject({ Container: "ts", VideoCodec: "h264" });
  });

  it("burns in every subtitle AVPlayer cannot render", () => {
    expect(IOS_DEVICE_PROFILE.SubtitleProfiles).toContainEqual({ Format: "vtt", Method: "Hls" });
    expect(IOS_DEVICE_PROFILE.SubtitleProfiles).toContainEqual({ Format: "ass", Method: "Encode" });
    expect(IOS_DEVICE_PROFILE.SubtitleProfiles).toContainEqual({ Format: "pgssub", Method: "Encode" });
    expect(IOS_DEVICE_PROFILE.SubtitleProfiles.filter((p) => p.Format === "srt")).toEqual([
      { Format: "srt", Method: "Encode" },
    ]);
  });

  it("is picked by platform", () => {
    expect(deviceProfileFor("ios")).toBe(IOS_DEVICE_PROFILE);
    expect(deviceProfileFor("android")).toBe(ANDROID_DEVICE_PROFILE);
    expect(JSON.parse(JSON.stringify(IOS_DEVICE_PROFILE))).toEqual(IOS_DEVICE_PROFILE);
  });
});
