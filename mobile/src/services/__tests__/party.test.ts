import { describe, expect, it } from "vitest";
import {
  backoffMs,
  bestOffset,
  broadcastMessage,
  broadcastOf,
  classifyJoinError,
  clockSample,
  decideCorrection,
  decodePhx,
  encodePhx,
  expectedPosition,
  formatCode,
  heartbeatMessage,
  joinMessage,
  matchesIds,
  normalizeCode,
  parseSync,
  parseTitle,
  presenceDiff,
  presenceHost,
  presenceList,
  presenceSync,
  replyOf,
  topicOf,
  trackMessage,
  type PartySync,
} from "../party.pure";

describe("party codes", () => {
  it("normalizes what people type", () => {
    expect(normalizeCode(" abcd-efgh jkmn ")).toBe("ABCDEFGHJKMN");
    expect(normalizeCode("ABCD·EFGH·JKMN")).toBe("ABCDEFGHJKMN");
    expect(formatCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normalizeCode(formatCode("ABCDEFGHJKMN"))).toBe("ABCDEFGHJKMN");
  });

  it("refuses ambiguous symbols and wrong lengths", () => {
    expect(normalizeCode("ABCD-EFGH-JKMO")).toBeNull();
    expect(normalizeCode("ABCD-EFGH-JK10")).toBeNull();
    expect(normalizeCode("ABCD-EFGH")).toBeNull();
  });

  it("derives the channel from the code (same topic as the desktop app)", () => {
    expect(topicOf("ABCDEFGHJKMN")).toBe("realtime:ejflix-party-abcdefghjkmn");
  });
});

describe("Phoenix messages", () => {
  it("encodes a join the way Supabase Realtime expects", () => {
    const join = joinMessage("realtime:room", "me", "1");
    const value = JSON.parse(encodePhx(join));
    expect(value.event).toBe("phx_join");
    expect(value.ref).toBe("1");
    expect(value.join_ref).toBe("1");
    expect(value.payload.config.presence.key).toBe("me");
    expect(value.payload.config.broadcast).toEqual({ self: false, ack: false });
    expect(value.payload.config.private).toBe(false);
    expect(value.payload.access_token).toBeUndefined();
    expect(joinMessage("t", "me", "1", true, "jwt").payload).toMatchObject({ access_token: "jwt" });
  });

  it("round-trips and tolerates server pushes without refs", () => {
    const beat = heartbeatMessage("7");
    expect(decodePhx(encodePhx(beat))).toEqual(beat);
    const push = decodePhx('{"topic":"realtime:room","event":"presence_diff","payload":{}}');
    expect(push?.ref).toBeNull();
    expect(decodePhx("nope")).toBeNull();
    expect(decodePhx('{"event":"x"}')).toBeNull();
  });

  it("reads replies", () => {
    const ok = decodePhx('{"topic":"t","event":"phx_reply","payload":{"status":"ok","response":{}},"ref":"1"}');
    expect(ok && replyOf(ok)).toEqual({ ok: true });
    const err = decodePhx(
      '{"topic":"t","event":"phx_reply","payload":{"status":"error","response":{"reason":"PrivateOnly: This project only allows private channels"}},"ref":"1"}',
    );
    expect(err && replyOf(err)).toEqual({ ok: false, reason: "PrivateOnly: This project only allows private channels" });
    expect(replyOf(heartbeatMessage("1"))).toBeNull();
  });

  it("wraps and unwraps broadcasts with the sender", () => {
    const msg = broadcastMessage("t", "sync_req", "abc", { x: 1 }, "2", "1");
    expect(msg.payload).toEqual({ type: "broadcast", event: "sync_req", payload: { from: "abc", data: { x: 1 } } });
    expect(broadcastOf(msg.payload)).toEqual({ event: "sync_req", from: "abc", data: { x: 1 } });
    expect(broadcastOf({ event: "chat", payload: {} })).toBeNull();
    expect(trackMessage("t", { name: "Ana" }, "3", "1").payload).toMatchObject({ type: "presence", event: "track" });
  });

  it("classifies join refusals", () => {
    const privateOnly = "PrivateOnly: This project only allows private channels";
    expect(classifyJoinError(privateOnly, false, true)).toBe("try-private");
    expect(classifyJoinError(privateOnly, false, false)).toBe("needs-account");
    expect(classifyJoinError("Unauthorized: You do not have permissions", true, true)).toBe("denied");
    expect(classifyJoinError("TenantNotFound", false, false)).toBe("other");
  });

  it("backs off up to half a minute", () => {
    expect(backoffMs(1, 0)).toBe(1000);
    expect(backoffMs(3, 0)).toBe(4000);
    expect(backoffMs(20, 1)).toBe(31_000);
  });
});

describe("presence", () => {
  it("follows joins and leaves, including a member reconnecting", () => {
    let presence = presenceSync({
      h: { metas: [{ phx_ref: "a", name: "Host", host: true, avatar: "preset:3" }] },
      g: { metas: [{ phx_ref: "b", name: "Guest", avatar: "http://example/x.png" }] },
    });
    expect(presenceHost(presence)).toBe("h");
    const list = presenceList(presence);
    expect(list.map((m) => m.name)).toEqual(["Host", "Guest"]);
    expect(list[0].avatar).toBe("preset:3");
    expect(list[1].avatar).toBeNull();

    presence = presenceDiff(presence, { joins: { g: { metas: [{ phx_ref: "c", name: "Guest" }] } }, leaves: {} });
    presence = presenceDiff(presence, { joins: {}, leaves: { g: { metas: [{ phx_ref: "b" }] } } });
    expect(presenceList(presence)).toHaveLength(2);
    presence = presenceDiff(presence, { joins: {}, leaves: { h: { metas: [{ phx_ref: "a" }] } } });
    expect(presenceHost(presence)).toBeNull();
    expect(presenceList(presence)).toHaveLength(1);
  });
});

describe("host title", () => {
  it("keeps only well-formed fields", () => {
    const title = parseTitle({
      key: "series:tt1:1:2",
      kind: "series",
      name: "Pilot",
      seriesName: "Show",
      year: 2020,
      season: 1,
      episode: 2,
      ids: { imdb: "tt1", tmdb: 5 },
      addon: { type: "series", metaId: "tt1", videoId: "tt1:1:2", prefer: null },
    });
    expect(title?.ids).toEqual({ imdb: "tt1" });
    expect(title?.addon?.videoId).toBe("tt1:1:2");
    expect(parseTitle({ key: "x", name: "Live", kind: "weird" })?.kind).toBe("unsupported");
    expect(parseTitle({ name: "no key" })).toBeNull();
  });

  it("matches library provider ids in any case", () => {
    expect(matchesIds({ Imdb: "tt1", Tmdb: "9" }, { imdb: "tt1" })).toBe(true);
    expect(matchesIds({ Tvdb: "7" }, { tvdb: "7" })).toBe(true);
    expect(matchesIds({ Imdb: "tt2" }, { imdb: "tt1" })).toBe(false);
  });
});

describe("sync", () => {
  const remote: PartySync = { key: "k", pos: 100, paused: false, rate: 1, at: 10_000, open: false };

  it("projects the host forward while playing, not while paused", () => {
    expect(expectedPosition(remote, 12_000)).toBeCloseTo(102);
    expect(expectedPosition({ ...remote, rate: 1.5 }, 12_000)).toBeCloseTo(103);
    expect(expectedPosition({ ...remote, paused: true }, 60_000)).toBe(100);
    // A stale report (or a clock far off) is not projected past 15 s.
    expect(expectedPosition(remote, 1_000_000)).toBeCloseTo(115);
  });

  it("seeks only past the drift threshold", () => {
    const local = { time: 101.5, paused: false, speed: 1, duration: 3600 };
    expect(decideCorrection(local, remote, 12_000, 50_000, 0)).toEqual({ seek: null, pause: null, rate: null });
    const far = decideCorrection({ ...local, time: 95 }, remote, 12_000, 50_000, 0);
    expect(far.seek).toBeCloseTo(102);
  });

  it("is stricter while paused and follows pause and speed", () => {
    const local = { time: 100.6, paused: false, speed: 1.25, duration: 3600 };
    const fix = decideCorrection(local, { ...remote, paused: true }, 12_000, 50_000, 0);
    expect(fix.pause).toBe(true);
    expect(fix.rate).toBe(1);
    expect(fix.seek).toBe(100);
  });

  it("waits after a seek and stays inside the file", () => {
    const local = { time: 10, paused: false, speed: 1, duration: 3600 };
    expect(decideCorrection(local, remote, 12_000, 50_000, 48_000).seek).toBeNull();
    const end = decideCorrection({ ...local, duration: 90 }, remote, 12_000, 50_000, 0);
    expect(end.seek).toBe(89);
  });

  it("estimates the clock offset from the fastest ping", () => {
    const slow = clockSample(1000, 6200, 1400);
    const fast = clockSample(2000, 7050, 2100);
    expect(fast).toEqual({ offset: 5000, rtt: 100 });
    expect(bestOffset([slow, fast])).toBe(5000);
    expect(bestOffset([])).toBe(0);
  });

  it("parses host reports defensively", () => {
    expect(parseSync({ key: "k", pos: -3, at: 1, rate: 9, paused: 1 })).toEqual({
      key: "k",
      pos: 0,
      paused: false,
      rate: 1,
      at: 1,
      open: false,
    });
    expect(parseSync({ key: "k", pos: "1", at: 1 })).toBeNull();
  });
});
