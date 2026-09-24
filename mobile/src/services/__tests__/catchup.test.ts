import { describe, expect, it } from "vitest";
import type { Reminder } from "../../lib/types";
import {
  addReminder,
  catchupUrl,
  catchupWindow,
  dropReminder,
  dueReminders,
  fillCatchup,
  formatStamp,
  m3uCatchup,
  pruneReminders,
  serverOffset,
} from "../iptv/catchup";
import { parseM3u } from "../iptv/m3u";
import { xtreamChannels } from "../iptv/xtream";

// 2024-03-10 20:30:00 UTC
const START = 1_710_102_600;

describe("catch-up", () => {
  it("formats stamps and fills templates", () => {
    expect(formatStamp("Y-m-d:H-M", START)).toBe("2024-03-10:20-30");
    expect(
      fillCatchup("http://h/a.m3u8?s=${start}&e={utcend}&d={duration:60}&x={Y}{m}{d}&k={keep}", START, START + 3600, START + 7200),
    ).toBe("http://h/a.m3u8?s=1710102600&e=1710106200&d=60&x=20240310&k={keep}");
    expect(fillCatchup("{utc:Y/m/d H:M}", START, START, START)).toBe("2024/03/10 20:30");
    expect(fillCatchup("?o={offset:60}&n={lutc}", START, START + 60, START + 600)).toBe("?o=10&n=1710103200");
  });

  it("reads the M3U and Xtream archive fields", () => {
    const text = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="a" catchup="shift" catchup-days="3",A',
      "http://h/a.m3u8",
      '#EXTINF:-1 catchup-source="?utc={utc}",B',
      "http://h/b.m3u8",
      '#EXTINF:-1 catchup="flussonic",C',
      "http://h/c.m3u8",
      "#EXTINF:-1,D",
      "http://h/d.m3u8",
    ].join("\n");
    const [a, b, c, d] = parseM3u(text, "src").channels;
    expect([a.catchup, a.catchupDays]).toEqual(["shift", 3]);
    expect([b.catchup, b.catchupDays]).toEqual(["default", 1]);
    expect(catchupWindow(c)).toBe(0);
    // Channels without an archive carry no extra fields.
    expect("catchup" in d).toBe(false);
    expect(m3uCatchup(new Map([["catchup", "append"]]))).toBeNull();

    const streams = [
      { name: "X", stream_id: 9, tv_archive: 1, tv_archive_duration: "5" },
      { name: "Y", stream_id: 10, tv_archive: 0 },
    ];
    const [x, y] = xtreamChannels("src", null, streams, "live");
    expect(catchupWindow(x)).toBe(5);
    expect(catchupWindow(y)).toBe(0);

    expect(serverOffset({ server_info: { time_now: "2024-03-10 21:30:04", timestamp_now: START } })).toBe(3600);
    expect(serverOffset({})).toBe(0);
  });

  it("builds archive urls inside the window only", () => {
    const now = START + 7200;
    const channel = { kind: "live", url: "http://h/a.m3u8", streamId: "", catchup: "shift", catchupSource: "", catchupDays: 1 };
    expect(catchupUrl(null, channel, START, START + 3600, now)).toBe(`http://h/a.m3u8?utc=${START}&lutc=${now}`);
    expect(() => catchupUrl(null, channel, START, START + 3600, START + 2 * 86_400)).toThrow();
    expect(() => catchupUrl(null, channel, now + 60, now + 600, now)).toThrow();
    const xtream = { kind: "live", url: "", streamId: "77", catchup: "xtream", catchupDays: 2 };
    expect(catchupUrl({ base: "http://s:80", username: "u@x", password: "p", output: "ts" }, xtream, START, START + 3000, now, 3600)).toBe(
      "http://s:80/timeshift/u%40x/p/50/2024-03-10:21-30/77.ts",
    );
  });
});

describe("reminders", () => {
  const reminder = (start: number, channelId = "src:1"): Reminder => ({
    channelId,
    sourceId: "src",
    channelName: "Uno",
    logo: null,
    group: "",
    number: null,
    title: "Noticias",
    start,
    stop: start + 1800,
  });

  it("adds, replaces, drops and expires", () => {
    const now = START;
    let list = addReminder([], reminder(now + 600), now);
    list = addReminder(list, reminder(now + 300, "src:2"), now);
    list = addReminder(list, reminder(now + 600), now);
    expect(list.map((r) => r.channelId)).toEqual(["src:2", "src:1"]);
    expect(() => addReminder(list, reminder(now - 1), now)).toThrow("El programa ya ha empezado");
    expect(dropReminder(list, "src:2", now + 300, now)).toHaveLength(1);
    expect(pruneReminders(list, now + 300 + 301)).toHaveLength(1);
  });

  it("announces each reminder once, a minute before", () => {
    const now = START;
    const list = [reminder(now + 50), reminder(now + 120, "src:2")];
    const first = dueReminders(list, now);
    expect(first.due.map((r) => r.channelId)).toEqual(["src:1"]);
    expect(dueReminders(first.list, now + 10).due).toHaveLength(0);
    expect(dueReminders(first.list, now + 61).due.map((r) => r.channelId)).toEqual(["src:2"]);
  });
});
