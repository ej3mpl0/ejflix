import { describe, expect, it } from "vitest";
import {
  normalizeHttpUrl,
  parseAccount,
  parseXtreamUrl,
  percentDecode,
  xtreamApiUrl,
  xtreamChannels,
  xtreamStreamUrl,
} from "../iptv/xtream";

describe("xtream", () => {
  it("parses xtream urls", () => {
    const full = parseXtreamUrl("http://host.tv:8080/get.php?username=u%201&password=p&type=m3u_plus");
    expect(full.base).toBe("http://host.tv:8080");
    expect(full.username).toBe("u 1");
    expect(full.password).toBe("p");
    const bare = parseXtreamUrl("host.tv:8080");
    expect(bare.base).toBe("http://host.tv:8080");
    expect(bare.username).toBeNull();
    expect(() => parseXtreamUrl("ftp://x")).toThrow("Solo se permiten URLs http o https");
    expect(() => normalizeHttpUrl("")).toThrow("URL no válida");
    expect(() => normalizeHttpUrl("http://a b")).toThrow("URL no válida");
    expect(percentDecode("a+b%C3%B1%zz")).toBe("a bñ%zz");
  });

  it("builds api and stream urls", () => {
    expect(xtreamApiUrl("http://h", "u", "p@ss", "get_live_streams")).toBe(
      "http://h/player_api.php?username=u&password=p%40ss&action=get_live_streams",
    );
    expect(xtreamStreamUrl("http://h", "u", "p", "m3u8", { kind: "live", streamId: "5", container: "" })).toBe(
      "http://h/live/u/p/5.m3u8",
    );
    expect(xtreamStreamUrl("http://h", "u", "p", "ts", { kind: "movie", streamId: "9", container: "mkv" })).toBe(
      "http://h/movie/u/p/9.mkv",
    );
    expect(xtreamStreamUrl("http://h", "u", "p", "ts", { kind: "movie", streamId: "9", container: "" })).toBe(
      "http://h/movie/u/p/9.mp4",
    );
  });

  it("parses streams and accounts", () => {
    const categories = [{ category_id: "3", category_name: "Deportes" }];
    const streams = [
      { num: 7, name: "  Canal  X ", stream_id: 55, stream_icon: "http://i/x.png", epg_channel_id: "x.es", category_id: "3" },
      { name: "Sin id" },
    ];
    const list = xtreamChannels("src", categories, streams, "live");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("src:s55");
    expect(list[0].name).toBe("Canal X");
    expect(list[0].group).toBe("Deportes");
    expect(list[0].number).toBe(7);
    expect(list[0].tvgId).toBe("x.es");
    expect(xtreamChannels("src", null, [{ name: "M", stream_id: "9", container_extension: "mkv" }], "movie")[0]).toMatchObject({
      id: "src:v9",
      kind: "movie",
      container: "mkv",
      group: "",
    });
    const ok = { user_info: { auth: 1, status: "Active", exp_date: "1900000000", max_connections: "2", is_trial: "0" } };
    const account = parseAccount(ok);
    expect(account.expiresMs).toBe(1_900_000_000_000);
    expect(account.maxConnections).toBe(2);
    expect(account.trial).toBe(false);
    expect(account.status).toBe("Active");
    expect(() => parseAccount({ user_info: { auth: 0, status: "Expired" } })).toThrow("La cuenta ha caducado");
    expect(() => parseAccount({ user_info: { auth: "0", status: "Banned" } })).toThrow("La cuenta está bloqueada");
    expect(() => parseAccount({ user_info: { auth: false } })).toThrow("Usuario o contraseña incorrectos");
    expect(() => parseAccount({ nope: 1 })).toThrow("El servidor no respondió como Xtream Codes");
    expect(parseAccount({ user_info: { auth: "true", exp_date: 0 } })).toEqual({
      status: "Active",
      expiresMs: null,
      maxConnections: null,
      activeConnections: null,
      trial: false,
    });
  });
});
