import type { Person } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { ScrollRow } from "./ScrollRow";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Circular cast avatars with name and role (Nuvio style). */
export function CastRow({ people }: { people: Person[] }) {
  const { t } = useI18n();
  if (!people.length) return null;
  return (
    <section>
      <h2 className="mb-4 text-[18px] font-semibold">{t("cast")}</h2>
      <ScrollRow className="pb-2">
        {people.map((person) => (
          <div key={person.id} className="w-[116px] shrink-0 text-center">
            <div className="img-outline mx-auto grid h-[88px] w-[88px] place-items-center overflow-hidden rounded-full bg-panel text-[22px] font-semibold text-muted">
              {person.imageUrl ? (
                <img src={person.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                initials(person.name)
              )}
            </div>
            {/* A fixed block: a long name or a two-line character must not make this
                card taller than the one beside it. */}
            <div className="mt-2 h-[50px]">
              <p title={person.name} className="line-clamp-1 text-[13px] font-medium leading-[1.3] text-text">
                {person.name}
              </p>
              {person.role ? (
                <p title={person.role} className="line-clamp-2 text-[11px] leading-[1.3] text-dim">
                  {person.role}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </ScrollRow>
    </section>
  );
}
