import { describe, expect, it } from "vitest";
import { Utf8Stream, cleanName, normalize, parseExtinf, parseM3u, utf8Lossy } from "../iptv/m3u";

describe("m3u", () => {
  it("parses extinf attributes", () => {
    let parsed = parseExtinf('-1 tvg-id="La1.es" tvg-name="La 1" tvg-logo="http://x/l.png" group-title="TDT, España",La 1 HD');
    expect(parsed.attrs.get("tvg-id")).toBe("La1.es");
    expect(parsed.attrs.get("group-title")).toBe("TDT, España");
    expect(parsed.title).toBe("La 1 HD");
    parsed = parseExtinf("0,Solo nombre");
    expect(parsed.attrs.size).toBe(0);
    expect(parsed.title).toBe("Solo nombre");
    parsed = parseExtinf("-1 tvg-chno=12 group-title=Deportes,Canal 12");
    expect(parsed.attrs.get("tvg-chno")).toBe("12");
    expect(parsed.attrs.get("group-title")).toBe("Deportes");
    expect(parsed.title).toBe("Canal 12");
  });

  it("parses playlists", () => {
    const text =
      '#EXTM3U url-tvg="http://epg.example/guide.xml.gz"\r\n' +
      '#EXTINF:-1 tvg-id="a.es" tvg-logo="http://x/a.png" group-title="News",Canal A\r\n' +
      "#EXTVLCOPT:http-user-agent=VLC/3\r\n" +
      "http://host/a.ts\r\n" +
      "#EXTINF:-1,Canal B\r\n" +
      "#EXTGRP:Movies\r\n" +
      "http://host/movie/u/p/1.mkv\r\n" +
      "#EXTINF:-1,Canal B\r\n" +
      "http://host/b2.ts\r\n" +
      "#EXTINF:-1,Sin URL\r\n" +
      "rtmp://host/x\r\n";
    const parsed = parseM3u(text, "src");
    expect(parsed.epgUrl).toBe("http://epg.example/guide.xml.gz");
    expect(parsed.channels).toHaveLength(3);
    const a = parsed.channels[0];
    expect(a.id).toBe("src:i:a.es");
    expect(a.group).toBe("News");
    expect(a.userAgent).toBe("VLC/3");
    expect(a.logo).toBe("http://x/a.png");
    expect(a.kind).toBe("live");
    const b = parsed.channels[1];
    expect(b.id).toBe("src:n:canalb");
    expect(b.group).toBe("Movies");
    expect(b.kind).toBe("movie");
    expect(b.userAgent).toBeNull();
    expect(parsed.channels[2].id).toBe("src:n:canalb~2");
  });

  it("normalizes names", () => {
    expect(normalize("La 1 HD")).toBe("la1hd");
    expect(normalize("Canal+ Ñu (ES)")).toBe("canalñues");
    expect(cleanName("  Canal  X ")).toBe("Canal X");
    expect(parseM3u("#EXTINF:-1 group-title=\"A; B\" tvg-chno=\"07\",X\nhttp://h/x", "s").channels[0]).toMatchObject({
      group: "A",
      number: 7,
    });
  });

  it("decodes UTF-8 in chunks", () => {
    const text = "Noticias & más — ñ 😀 fin";
    const bytes = new TextEncoder().encode(text);
    expect(utf8Lossy(bytes)).toBe(text);
    expect(utf8Lossy([0xc3, 0x28, 0x41])).toBe("�(A");
    for (const manual of [true, false]) {
      for (const size of [1, 2, 3, 7]) {
        const stream = new Utf8Stream(manual);
        let out = "";
        for (let i = 0; i < bytes.length; i += size) out += stream.push(bytes.subarray(i, i + size));
        out += stream.finish();
        expect(out).toBe(text);
      }
    }
  });
});
