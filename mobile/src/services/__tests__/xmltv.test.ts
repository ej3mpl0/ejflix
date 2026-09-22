import { describe, expect, it } from "vitest";
import { Utf8Stream } from "../iptv/m3u";
import {
  XmltvScanner,
  attachGuideText,
  decodeEntities,
  epgNowOf,
  groupRows,
  linkGuide,
  parseXmltvTime,
  wantedFromChannels,
  type ProgrammeRow,
} from "../iptv/xmltv";

const channels = [
  { id: "s:1", name: "Canal A HD", tvgId: "A.es" },
  { id: "s:2", name: "Canal B", tvgId: "" },
  { id: "s:3", name: "Nadie", tvgId: "" },
];

const now = parseXmltvTime("20240601120000 +0000") as number;

const xml = `<?xml version="1.0"?><tv>
<channel id="a.es"><display-name>Canal A</display-name><icon src="x"/></channel>
<channel id="bb"><display-name lang="es">Canal B</display-name></channel>
<programme start="20240601110000 +0000" stop="20240601123000 +0000" channel="a.es"><title lang="es">Noticias &amp; m&#225;s</title><desc>Resumen</desc></programme>
<programme start="20240601123000 +0000" stop="20240601140000 +0000" channel="a.es"><title>Cine</title></programme>
<programme start="20240601130000 +0100" stop="20240601140000 +0100" channel="bb"><title>Tarde</title></programme>
<programme start="20240101000000 +0000" stop="20240101010000 +0000" channel="bb"><title>Viejo</title></programme>
</tv>`;

describe("xmltv", () => {
  it("parses xmltv and links channels", () => {
    const { channelEpg, epg } = attachGuideText(channels, xml, now);
    expect(channelEpg.get("s:1")).toBe("a.es");
    expect(channelEpg.get("s:2")).toBe("bb");
    expect(channelEpg.has("s:3")).toBe(false);
    const a = epg.get("a.es") ?? [];
    expect(a).toHaveLength(2);
    expect(a[0].title).toBe("Noticias & más");
    expect(a[0].desc).toBe("Resumen");
    const b = epg.get("bb") ?? [];
    expect(b).toHaveLength(1);
    expect(b[0].start).toBe(now); // 13:00 +0100 == 12:00 UTC
    const current = epgNowOf(a, now);
    expect(current.now?.title).toBe("Noticias & más");
    expect(current.next?.title).toBe("Cine");
    expect(epgNowOf(a, now + 3 * 3600)).toEqual({ now: null, next: null });
    expect(epgNowOf(a, now - 3600 - 1)).toMatchObject({ now: null, next: { title: "Noticias & más" } });
  });

  it("parses times", () => {
    expect(parseXmltvTime("19700102000000 +0000")).toBe(86_400);
    expect(parseXmltvTime("197001020000")).toBe(86_400);
    expect(parseXmltvTime("19700101230000 -0100")).toBe(86_400);
    expect(parseXmltvTime("nope")).toBeNull();
    expect(parseXmltvTime("20240601120000")).toBe(1_717_243_200);
    expect(parseXmltvTime("20241301000000")).toBeNull();
  });

  it("decodes entities", () => {
    expect(decodeEntities("a &amp; b &#x41;&#66; &nbsp;&unknown; &")).toBe("a & b AB  &unknown; &");
    expect(decodeEntities("no entities")).toBe("no entities");
  });

  it("streams in 7-byte chunks with the same result as one push", () => {
    const wanted = wantedFromChannels(channels);
    const one = new XmltvScanner(wanted.ids, wanted.names, now);
    one.push(xml);
    one.finish();
    const oneRows = one.drain();
    expect(oneRows.length).toBe(3);

    // Text chunks of 7 UTF-16 units.
    const chunked = new XmltvScanner(wanted.ids, wanted.names, now);
    const textRows: ProgrammeRow[] = [];
    for (let i = 0; i < xml.length; i += 7) {
      chunked.push(xml.slice(i, i + 7));
      textRows.push(...chunked.drain());
    }
    chunked.finish();
    textRows.push(...chunked.drain());
    expect(textRows).toEqual(oneRows);
    expect(Array.from(chunked.names)).toEqual(Array.from(one.names));
    expect(Array.from(chunked.idsWithProgrammes)).toEqual(Array.from(one.idsWithProgrammes));

    // Byte chunks of 7 through the streaming UTF-8 decoder (both decoder paths).
    const bytes = new TextEncoder().encode(xml);
    for (const manual of [true, false]) {
      const scanner = new XmltvScanner(wanted.ids, wanted.names, now);
      const utf8 = new Utf8Stream(manual);
      const rows: ProgrammeRow[] = [];
      for (let i = 0; i < bytes.length; i += 7) {
        scanner.push(utf8.push(bytes.subarray(i, i + 7)));
        rows.push(...scanner.drain());
      }
      scanner.push(utf8.finish());
      scanner.finish();
      rows.push(...scanner.drain());
      expect(rows).toEqual(oneRows);
      const link = linkGuide(channels, scanner.names, scanner.idsWithProgrammes);
      expect(link.get("s:1")).toBe("a.es");
      expect(link.get("s:2")).toBe("bb");
      expect(groupRows(rows).get("a.es")?.map((p) => p.title)).toEqual(["Noticias & más", "Cine"]);
    }
  });

  it("keeps an incomplete element until the rest arrives and drops it on finish", () => {
    const wanted = wantedFromChannels([{ id: "s:1", name: "X", tvgId: "x" }]);
    const scanner = new XmltvScanner(wanted.ids, wanted.names, now);
    scanner.push('<programme start="20240601110000 +0000" stop="20240601123000 +0000" channel="x"><title>Half');
    expect(scanner.drain()).toEqual([]);
    scanner.push("</title></programme><progr");
    expect(scanner.drain().map((r) => r.title)).toEqual(["Half"]);
    scanner.push('amme start="20240601123000 +0000" stop="20240601130000 +0000" channel="x"><title>Two</title>');
    scanner.finish();
    expect(scanner.drain()).toEqual([]);
    expect(scanner.count).toBe(1);
  });

  it("limits desc and dedups programmes", () => {
    const long = "x".repeat(300);
    const doc = `<tv><programme start="20240601110000 +0000" stop="20240601120000 +0000" channel="x"><title>T</title><desc>${long}</desc></programme>
<programme start="20240601110000 +0000" stop="20240601120000 +0000" channel="X"><title>T</title></programme></tv>`;
    const { epg, channelEpg } = attachGuideText([{ id: "s:1", name: "X", tvgId: "x" }], doc, now);
    expect(channelEpg.get("s:1")).toBe("x");
    const list = epg.get("x") ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].desc?.length).toBe(240);
  });
});
