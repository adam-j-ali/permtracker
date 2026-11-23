"use client";

import Link from "next/link";
import { Fragment, useId, useRef, useState, type KeyboardEvent } from "react";

import { choiceVariants } from "@/components/ui/choice";
import { formatInt, formatShareOf } from "@/lib/format";
import { NONE_FILL, blueFill } from "@/lib/mapScale";
import { legendSteps, stepBreaks, stepOf, type MapEra, type MapState } from "@/lib/stateMap";
import { stateName } from "@/lib/usStateNames";
import { US_MAP_VIEWBOX, US_STATES } from "@/lib/usStatesGeometry";
import { cn } from "@/lib/utils";

/**
 * Where one employer's, law firm's or job's filings are, state by state: the picture at the top of its "Where"
 * part. Census shapes (the by-state map's geometry), each state shaded in four steps of the information blue by its
 * count, a state with none plain paper (a known zero, never the hatch that means "not known").
 *
 * Hovering or focusing a state reads it out under the map; a tap, a click or Enter keeps it there (an ink outline),
 * and a kept state's line leads on, to its filings in the case search or wherever the page sends it. The states too
 * small to point at on a phone, and the territories the drawing has no shape for, are tiles under the map when they
 * hold filings. One tab stop: the arrow keys move between the states with filings, busiest first.
 *
 * It fits its column at every width and prints no words inside the drawing, where they would be a few pixels tall on
 * a phone: the readout and the tiles carry them. The page draws it only for two or more states, and only once the
 * nightly build says the facet holds every state (`canDrawStateMap`).
 */

/** Too small to point at on a phone. Drawn, and a tile when they hold filings. */
const SMALL = new Set(["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"]);
const SHAPES = new Map(US_STATES.map((s) => [s.abbr, s]));

/** A state reached by its tile rather than its shape: a small state, or a territory the drawing has no shape for. */
const byTile = (state: string) => SMALL.has(state) || !SHAPES.has(state);

export interface EntityStateMapProps {
  /** One span of years, or two the reader can switch between. */
  eras: MapEra[];
  /** The drawing's name, before the years: "Filings by worksite state". */
  label: string;
  noun?: "filings" | "cases";
  /** A state outlined as the subject's own (a law firm's office), with a line saying what it is. */
  office?: { state: string; label: string } | null;
  className?: string;
}

export function EntityStateMap({ eras, label, noun = "filings", office = null, className }: EntityStateMapProps) {
  const [eraId, setEraId] = useState(eras[0]?.id ?? "");
  const [pinned, setPinned] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const targets = useRef(new Map<string, SVGPathElement | HTMLButtonElement>());
  const hintId = useId();

  const era = eras.find((e) => e.id === eraId) ?? eras[0];
  if (!era || era.states.length === 0) return null;

  const order = era.states;
  const byState = new Map(order.map((s) => [s.state, s]));
  const breaks = stepBreaks(order[0]?.n ?? 1);
  const fillOf = (s: MapState) => blueFill(stepOf(s.n, breaks));
  const share = (n: number) => formatShareOf(n, Math.max(era.total, 1));
  const tabStop = [cursor, pinned].find((s) => s && byState.has(s)) ?? order[0]?.state ?? null;
  const shown = byState.get(previewed ?? pinned ?? "") ?? null;
  const tiles = order.filter((s) => byTile(s.state));
  const inStates = order.filter((s) => SHAPES.has(s.state)).length;
  const territories = order.filter((s) => !SHAPES.has(s.state)).map((s) => stateName(s.state));

  const describe = (s: MapState) =>
    [
      `${stateName(s.state)}: ${formatInt(s.n)} ${noun}, ${share(s.n)} of ${formatInt(era.total)} ${era.label}.`,
      s.certified + s.denied > 0 ? `${formatInt(s.certified)} certified, ${formatInt(s.denied)} denied.` : "",
      s.extra ? `${s.extra}.` : "",
      office?.state === s.state ? `${office.label}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const toggle = (state: string) => setPinned((p) => (p === state ? null : state));

  const move = (from: string, to: "next" | "prev" | "first" | "last") => {
    const i = order.findIndex((s) => s.state === from);
    const j = to === "first" ? 0 : to === "last" ? order.length - 1 : Math.max(0, Math.min(order.length - 1, i + (to === "next" ? 1 : -1)));
    const next = order[j]?.state;
    if (!next) return;
    setCursor(next);
    targets.current.get(next)?.focus();
  };

  const onKey = (e: KeyboardEvent<SVGPathElement | HTMLButtonElement>, state: string) => {
    const step = { ArrowRight: "next", ArrowDown: "next", ArrowLeft: "prev", ArrowUp: "prev", Home: "first", End: "last" } as const;
    const to = step[e.key as keyof typeof step];
    if (to) {
      e.preventDefault();
      move(state, to);
    } else if (e.key === "Escape") {
      setPinned(null);
    } else if ((e.key === "Enter" || e.key === " ") && !(e.currentTarget instanceof HTMLButtonElement)) {
      // A shape is a button by its role only, so its keys are handled here; a tile is a real button.
      e.preventDefault();
      toggle(state);
    }
  };

  const reach = (state: string) => ({
    onMouseEnter: () => setPreviewed(state),
    onMouseLeave: () => setPreviewed(null),
    onClick: () => toggle(state),
  });
  const control = (state: string) => ({
    ...reach(state),
    ref: (el: SVGPathElement | HTMLButtonElement | null) => {
      if (el) targets.current.set(state, el);
      else targets.current.delete(state);
    },
    tabIndex: state === tabStop ? 0 : -1,
    "aria-label": describe(byState.get(state)!),
    "aria-pressed": pinned === state,
    onFocus: () => {
      setPreviewed(state);
      setCursor(state);
    },
    onBlur: () => setPreviewed(null),
    onKeyDown: (e: KeyboardEvent<SVGPathElement | HTMLButtonElement>) => onKey(e, state),
  });

  const outline = (state: string | null | undefined, dashed = false) => {
    const shape = state ? SHAPES.get(state) : undefined;
    if (!shape) return null;
    return (
      <path
        d={shape.d}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth={dashed ? 2 : 2.5}
        strokeDasharray={dashed ? "5 3" : undefined}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    );
  };

  const busiest = order[0]!;

  return (
    <div className={cn("min-w-0", className)}>
      {eras.length > 1 ? (
        <div role="group" aria-label="Which years" className="mb-4 flex flex-wrap gap-2">
          {eras.map((e) => (
            <Fragment key={e.id}>
              {" "}
              <button
                type="button"
                aria-pressed={e.id === era.id}
                className={choiceVariants({ on: e.id === era.id })}
                onClick={() => {
                  setEraId(e.id);
                  setPinned(null);
                  setPreviewed(null);
                  setCursor(null);
                }}
              >
                {e.choice}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}{" "}
      <svg
        viewBox={`0 0 ${US_MAP_VIEWBOX.w} ${US_MAP_VIEWBOX.h}`}
        role="group"
        aria-label={`${label}, ${era.label}`}
        aria-describedby={hintId}
        className="block h-auto w-full"
      >
        {US_STATES.map((shape) => {
          const s = byState.get(shape.abbr);
          if (!s) {
            return (
              <path
                key={shape.abbr}
                d={shape.d}
                aria-hidden="true"
                style={{ fill: NONE_FILL, stroke: "var(--border)" }}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          // A small state is drawn and answers the pointer, but its tile is the control for the keyboard and a
          // screen reader, so the shape stays out of both.
          const props = byTile(shape.abbr)
            ? { ...reach(shape.abbr), "aria-hidden": true as const }
            : { ...control(shape.abbr), role: "button" };
          return (
            <path
              key={shape.abbr}
              d={shape.d}
              {...props}
              data-state={shape.abbr}
              className="cursor-pointer outline-none"
              style={{ fill: fillOf(s), stroke: "var(--input)" }}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* The outlines go last so they win the paint order: the office dashed, the state being read solid. */}
        {office ? outline(office.state, true) : null}
        {outline(pinned)}
        {previewed !== pinned ? outline(previewed) : null}
      </svg>{" "}
      <p id={hintId} className="sr-only">
        The arrow keys move between the states with {noun}, busiest first. Enter keeps one under the map, and Escape
        lets it go.
      </p>{" "}
      {tiles.length > 0 ? (
        <ul aria-label="Small states and territories" className="mt-3 flex flex-wrap gap-2">
          {tiles.map((s) => (
            <Fragment key={s.state}>
              {" "}
              <li>
                <button
                  type="button"
                  {...control(s.state)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 border-2 bg-card px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    pinned === s.state || previewed === s.state ? "border-foreground" : "border-input hover:border-foreground",
                  )}
                >
                  <span aria-hidden="true" className="size-3.5 shrink-0 border border-input" style={{ background: fillOf(s) }} />{" "}
                  <span>{s.state}</span>{" "}
                  <span className="font-mono tabular-nums text-muted-foreground">{formatInt(s.n)}</span>
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      ) : null}{" "}
      <ul aria-label="Key" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {legendSteps(busiest.n).map((l) => (
          <Fragment key={l.step}>
            {" "}
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3.5 w-6 border border-input" style={{ background: blueFill(l.step) }} />{" "}
              {l.text}
            </li>
          </Fragment>
        ))}{" "}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3.5 w-6 border border-border bg-card" /> None
        </li>{" "}
        {office ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3.5 w-6 border-2 border-dashed border-foreground" />{" "}
            {office.label}
          </li>
        ) : null}{" "}
        <li className="font-semibold text-foreground">
          {`In ${inStates} of ${US_STATES.length} states${territories.length ? ` and ${territories.join(", ")}` : ""}`}
        </li>
      </ul>{" "}
      <div className="mt-4 min-h-28 bg-tint p-4 sm:p-5">
        {shown ? (
          <>
            <p className="font-heading text-lg font-bold">{stateName(shown.state)}</p>{" "}
            <p className="mt-1 text-base">
              {`${formatInt(shown.n)} ${noun}, ${share(shown.n)} of ${formatInt(era.total)} ${era.label}`}
            </p>{" "}
            {shown.certified + shown.denied > 0 ? (
              <p className="text-sm text-muted-foreground">
                {`${formatInt(shown.certified)} certified, ${formatInt(shown.denied)} denied`}
              </p>
            ) : null}{" "}
            {shown.extra ? <p className="mt-1 text-base">{shown.extra}</p> : null}{" "}
            {office?.state === shown.state ? <p className="text-sm text-muted-foreground">{office.label}</p> : null}{" "}
            {pinned === shown.state && shown.href ? (
              <Link href={shown.href} className="link mt-1 inline-flex min-h-11 items-center font-semibold">
                {shown.linkText ?? `Its ${noun} in ${stateName(shown.state)}`}
              </Link>
            ) : null}
          </>
        ) : (
          <p className="text-base">
            {`${stateName(busiest.state)} has the most: ${formatInt(busiest.n)} of ${formatInt(era.total)} ${noun} ${era.label}, or ${share(busiest.n)}.`}
          </p>
        )}
      </div>
    </div>
  );
}
