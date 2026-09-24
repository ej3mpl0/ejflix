import { describe, expect, it } from "vitest";
import { LocalizedError, errorText } from "../errors";
import { PlaybackError } from "../events";
import { translate } from "../../lib/i18n";

const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars);

describe("errorText", () => {
  it("translates errors that carry a key, with their values", () => {
    expect(errorText(new LocalizedError("errWrongCredentials", "Usuario o contraseña incorrectos"), en)).toBe("Wrong username or password.");
    expect(errorText(new LocalizedError("errServerStatus", "El servidor respondió 502", { status: 502 }), en)).toBe(
      "The server answered with code 502.",
    );
    expect(errorText(new PlaybackError("playErrNotAllowed", "El servidor no permite reproducir este archivo"), en)).toBe(
      "The server does not allow playing this file.",
    );
  });

  it("keeps the raw message of anything else", () => {
    expect(errorText(new Error("boom"), en)).toBe("boom");
    expect(errorText("plain", en)).toBe("plain");
  });

  it("keeps the Spanish message for logs", () => {
    expect(new LocalizedError("errNoSession", "No hay sesión activa").message).toBe("No hay sesión activa");
  });
});
