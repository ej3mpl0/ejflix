import { beforeAll, describe, expect, it } from "vitest";
import { configureImages } from "../jellyfin/images";
import { DETAIL_FIELDS, ITEM_FIELDS, mapItem, parseChapters, parseTrickplay, qualityFromStreams } from "../jellyfin/items";

const SERVER = "https://jf.example";

beforeAll(() => {
  configureImages({ serverUrl: SERVER, token: "tok" });
});

const movie = {
  Id: "movie-1234",
  Name: "Dune",
  Type: "Movie",
  Overview: "Sand.",
  ProductionYear: 2021,
  RunTimeTicks: 93_000_000_000,
  OfficialRating: "PG-13",
  CommunityRating: 8.1,
  CriticRating: 83,
  Genres: ["Sci-Fi", "Adventure"],
  ImageTags: { Primary: "p1", Logo: "l1" },
  BackdropImageTags: ["b1"],
  UserData: { PlaybackPositionTicks: 100, PlayedPercentage: 12.5, IsFavorite: true, Played: false },
  MediaStreams: [
    { Type: "Video", Width: 3840, Height: 2160, Codec: "hevc", Profile: "Main 10", VideoRangeType: "HDR10" },
    { Type: "Audio", Codec: "eac3", DisplayTitle: "English Atmos", ChannelLayout: "7.1", Channels: 8 },
    { Type: "Audio", Codec: "aac", ChannelLayout: "stereo", Channels: 2 },
    { Type: "Subtitle", DisplayTitle: "Español" },
    { Type: "Subtitle", Language: "eng" },
    { Type: "Subtitle" },
  ],
  MediaSources: [
    { Id: "src-a", Container: "mkv", Name: "" },
    { Id: "src-b", Container: "mp4", Name: "Extended" },
  ],
  People: [
    { Id: "person-1", Name: "Timothée", Type: "Actor", Role: "Paul", PrimaryImageTag: "t1" },
    { Id: "person-2", Name: "Rebecca", Type: "Actor", Role: "" },
    { Id: "person-3", Name: "Denis", Type: "Director" },
    { Id: "person-4", Name: "Jon", Type: "Writer" },
  ],
  Studios: [{ Name: "Legendary" }],
  ProviderIds: { Imdb: "tt1160419", Tmdb: "438631", Bad: 5 },
  RemoteTrailers: [{ Url: "https://yt/1" }],
  Taglines: ["Beyond fear, destiny awaits."],
  DateCreated: "2024-01-02T00:00:00Z",
  Trickplay: {
    "src-b": {
      "320": { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 93, Interval: 10000, Bandwidth: 1 },
    },
    "src-a": {
      "640": { Width: 640, Height: 360, TileWidth: 10, TileHeight: 10, ThumbnailCount: 93, Interval: 10000, Bandwidth: 2 },
      "320": { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 93, Interval: 10000, Bandwidth: 1 },
      "bad": { Width: 0 },
    },
  },
  Chapters: [
    { StartPositionTicks: 0, Name: "Start", ImageTag: "c0" },
    { StartPositionTicks: 600_000_000, Name: "" },
  ],
};

const episode = {
  Id: "episode-5678",
  Name: "Pilot",
  Type: "Episode",
  SeriesId: "series-9999",
  SeriesName: "Show",
  SeasonId: "season-0001",
  ParentIndexNumber: 1,
  IndexNumber: 3,
  SeriesPrimaryImageTag: "sp",
  ImageTags: { Primary: "still" },
  ParentBackdropItemId: "series-9999",
  ParentBackdropImageTags: ["sb"],
  ParentLogoItemId: "series-9999",
  ParentLogoImageTag: "sl",
  UserData: { UnplayedItemCount: 4 },
};

describe("mapItem", () => {
  it("maps a movie like jellyfin.rs::map_item", () => {
    const m = mapItem(movie);
    expect(m.id).toBe("movie-1234");
    expect(m.kind).toBe("Movie");
    expect(m.year).toBe(2021);
    expect(m.runtimeTicks).toBe(93_000_000_000);
    expect(m.communityRating).toBe(8.1);
    expect(m.genres).toEqual(["Sci-Fi", "Adventure"]);
    expect(m.posterUrl).toBe(`${SERVER}/Items/movie-1234/Images/Primary?maxWidth=400&quality=90&tag=p1&api_key=tok`);
    expect(m.backdropUrl).toBe(`${SERVER}/Items/movie-1234/Images/Backdrop/0?maxWidth=1920&quality=90&tag=b1&api_key=tok`);
    expect(m.logoUrl).toBe(`${SERVER}/Items/movie-1234/Images/Logo?maxWidth=600&quality=90&tag=l1&api_key=tok`);
    expect(m.thumbUrl).toBeNull();
    expect(m.playbackPositionTicks).toBe(100);
    expect(m.playedPercentage).toBe(12.5);
    expect(m.favorite).toBe(true);
    expect(m.played).toBe(false);
    expect(m.badges).toEqual(["4K", "HDR10", "ATMOS", "7.1"]);
    expect(m.videoLabel).toBe("3840×2160 HEVC Main 10 · HDR10");
    expect(m.audioLabel).toBe("English Atmos");
    expect(m.subtitleLabels).toEqual(["Español", "eng", "Subtítulo"]);
    expect(m.directors).toEqual(["Denis"]);
    expect(m.writers).toEqual(["Jon"]);
    expect(m.studios).toEqual(["Legendary"]);
    expect(m.cast).toEqual([
      {
        id: "person-1",
        name: "Timothée",
        role: "Paul",
        kind: "Actor",
        imageUrl: `${SERVER}/Items/person-1/Images/Primary?maxWidth=240&quality=90&tag=t1&api_key=tok`,
      },
      { id: "person-2", name: "Rebecca", role: null, kind: "Actor", imageUrl: null },
    ]);
    expect(m.providerIds).toEqual({ Imdb: "tt1160419", Tmdb: "438631" });
    expect(m.remoteTrailers).toEqual(["https://yt/1"]);
    expect(m.tagline).toBe("Beyond fear, destiny awaits.");
    expect(m.mediaSourceId).toBe("src-a");
    expect(m.mediaSources).toEqual([
      { id: "src-a", name: "MKV" },
      { id: "src-b", name: "Extended" },
    ]);
    expect(m.dateCreated).toBe("2024-01-02T00:00:00Z");
    expect(m.trickplay).toEqual({
      mediaSourceId: "src-a",
      levels: [
        { width: 320, height: 180, tileWidth: 10, tileHeight: 10, thumbnailCount: 93, interval: 10000, bandwidth: 1 },
        { width: 640, height: 360, tileWidth: 10, tileHeight: 10, thumbnailCount: 93, interval: 10000, bandwidth: 2 },
      ],
    });
    expect(m.chapters).toEqual([
      { index: 0, startSeconds: 0, name: "Start", imageTag: "c0" },
      { index: 1, startSeconds: 60, name: null, imageTag: null },
    ]);
    expect(m.seasonNumber).toBeNull();
    expect(m.episodeNumber).toBeNull();
    expect(m.endYear).toBeNull();
  });

  it("maps an episode: series poster, own still as thumb, parent backdrop/logo", () => {
    const e = mapItem(episode);
    expect(e.kind).toBe("Episode");
    expect(e.seriesId).toBe("series-9999");
    expect(e.seasonNumber).toBe(1);
    expect(e.episodeNumber).toBe(3);
    expect(e.posterUrl).toBe(`${SERVER}/Items/series-9999/Images/Primary?maxWidth=400&quality=90&tag=sp&api_key=tok`);
    expect(e.thumbUrl).toBe(`${SERVER}/Items/episode-5678/Images/Primary?maxWidth=640&quality=90&tag=still&api_key=tok`);
    expect(e.backdropUrl).toBe(`${SERVER}/Items/series-9999/Images/Backdrop/0?maxWidth=1920&quality=90&tag=sb&api_key=tok`);
    expect(e.logoUrl).toBe(`${SERVER}/Items/series-9999/Images/Logo?maxWidth=600&quality=90&tag=sl&api_key=tok`);
    expect(e.unplayedCount).toBe(4);
    expect(e.mediaSourceId).toBeNull();
    expect(e.mediaSources).toEqual([]);
    expect(e.trickplay).toBeNull();
    expect(e.chapters).toEqual([]);
    expect(e.name).toBe("Pilot");
  });

  it("handles seasons, series and missing fields", () => {
    const season = mapItem({ Id: "season-0001", Type: "Season", IndexNumber: 2, ChildCount: 10 });
    expect(season.seasonNumber).toBe(2);
    expect(season.childCount).toBe(10);
    expect(season.name).toBe("Sin título");
    // Primary without a tag is still a URL; other kinds need a tag.
    expect(season.posterUrl).toBe(`${SERVER}/Items/season-0001/Images/Primary?maxWidth=400&quality=90&api_key=tok`);
    expect(season.logoUrl).toBeNull();
    expect(season.backdropUrl).toBeNull();
    const series = mapItem({ Id: "series-9999", Type: "Series", Status: "Ended", EndDate: "2019-05-19T00:00:00Z" });
    expect(series.status).toBe("Ended");
    expect(series.endYear).toBe(2019);
    expect(() => mapItem({ Name: "no id" })).toThrow("Ítem sin id");
  });
});

describe("qualityFromStreams", () => {
  it("builds badges in stream order without duplicates", () => {
    const { badges, videoLabel, audioLabel } = qualityFromStreams([
      { Type: "Video", Width: 1920, Height: 1080, Codec: "h264", VideoRange: "SDR" },
      { Type: "Audio", Codec: "ac3", ChannelLayout: "5.1", Channels: 6 },
      { Type: "Audio", Codec: "ac3", ChannelLayout: "5.1", Channels: 6 },
    ]);
    expect(badges).toEqual(["1080P", "5.1"]);
    expect(videoLabel).toBe("1920×1080 H264 · SDR");
    expect(audioLabel).toBe("AC3 5.1");
  });
  it("prefers Dolby Vision over HDR10 and HDR10+ over HDR10", () => {
    expect(qualityFromStreams([{ Type: "Video", VideoRangeType: "DOVIWithHDR10" }]).badges).toEqual(["DOLBY VISION"]);
    expect(qualityFromStreams([{ Type: "Video", VideoRangeType: "HDR10+" }]).badges).toEqual(["HDR10+"]);
    expect(qualityFromStreams([{ Type: "Video", VideoRangeType: "HLG" }]).badges).toEqual(["HLG"]);
  });
});

describe("parseTrickplay / parseChapters", () => {
  it("returns null for empty or invalid trickplay", () => {
    expect(parseTrickplay(undefined, null)).toBeNull();
    expect(parseTrickplay({}, null)).toBeNull();
    expect(parseTrickplay({ a: { x: { Width: 1 } } }, "a")).toBeNull();
  });
  it("falls back to the first media source", () => {
    const info = parseTrickplay(movie.Trickplay, "missing");
    expect(info?.mediaSourceId).toBe("src-b");
  });
  it("parses chapters with defaults", () => {
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters([{}])).toEqual([{ index: 0, startSeconds: 0, name: null, imageTag: null }]);
  });
});

describe("fields", () => {
  it("matches the Rust field lists", () => {
    expect(ITEM_FIELDS).toBe(
      "Overview,Genres,MediaStreams,MediaSources,ProductionYear,RunTimeTicks,OfficialRating,CommunityRating,CriticRating,People,ImageTags,BackdropImageTags,DateCreated,Studios,ProviderIds,RemoteTrailers,ChildCount,Status,Taglines,EndDate",
    );
    expect(DETAIL_FIELDS).toBe(`${ITEM_FIELDS},Trickplay,Chapters`);
  });
});
