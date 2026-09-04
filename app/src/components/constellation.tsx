"use client";

/**
 * A pin's declared powers, drawn as reach rather than listed as rows.
 *
 * A bulleted list of `(target, selector)` pairs tells you what a skill may call but not how much that
 * amounts to. Two pins with one capability each look identical in a list even when one can quote a
 * price and the other can grant an unlimited allowance over your balance.
 *
 * Drawn as spokes from the account: each capability is one arm, its length set by how far the power
 * reaches, its weight by severity. A narrow read-only skill is a small tight star; a wide one that
 * can move tokens is a sprawl with heavy arms. That difference is the thing a person is being asked
 * to approve, and it is legible in about a second.
 *
 * The list stays underneath. This is a summary, not a replacement -- nobody should approve a
 * capability set from a picture alone.
 */

import { useMemo } from "react";

import type { Capability } from "@/lib/model";

import { motion, useReducedMotion } from "./motion";
import { cx } from "./ui";

const SIZE = 220;
const CENTRE = SIZE / 2;
const HUB = 15;

/** High-risk arms reach further, because severity is what makes reach matter. */
const REACH_SAFE = 62;
const REACH_RISKY = 88;

export function CapabilityConstellation({
  capabilities,
  movesNativeValue,
  className,
}: {
  capabilities: readonly Capability[];
  movesNativeValue: boolean;
  className?: string;
}) {
  const still = useReducedMotion();

  const arms = useMemo(() => {
    const count = Math.max(capabilities.length, 1);

    return capabilities.map((capability, index) => {
      /*
       * Spokes start at twelve o'clock and go clockwise, offset by half a step.
       *
       * The offset stops a two-capability pin drawing a single vertical line through the hub, which
       * reads as one arm rather than two.
       */
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2 + Math.PI / count;
      const reach = capability.highRisk ? REACH_RISKY : REACH_SAFE;

      return {
        capability,
        x: CENTRE + Math.cos(angle) * reach,
        y: CENTRE + Math.sin(angle) * reach,
        reach,
        index,
      };
    });
  }, [capabilities]);

  const riskyCount = capabilities.filter((c) => c.highRisk).length;

  return (
    <div className={cx("relative", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img"
        aria-label={`${capabilities.length} declared ${capabilities.length === 1 ? "capability" : "capabilities"}, ${riskyCount} of them high risk`}
      >
        {/* Range rings, so arm length is comparable between pins rather than only within one. */}
        {[REACH_SAFE, REACH_RISKY].map((r) => (
          <circle
            key={r}
            cx={CENTRE}
            cy={CENTRE}
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeDasharray="2 4"
          />
        ))}

        {/*
          The native-value halo. A skill that can move native value has a reach that is not captured
          by any single arm, so it gets a boundary of its own.
        */}
        {movesNativeValue ? (
          <motion.circle
            cx={CENTRE}
            cy={CENTRE}
            r={REACH_RISKY + 14}
            fill="none"
            stroke="var(--attention)"
            strokeWidth={1}
            strokeDasharray="1 5"
            animate={still ? { opacity: 0.5 } : { opacity: [0.28, 0.6, 0.28] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}

        {arms.map((arm) => {
          const risky = arm.capability.highRisk;
          const colour = risky ? "var(--revoked)" : "var(--pinned)";

          return (
            <motion.g
              key={`${arm.capability.target}-${arm.capability.selector}`}
              initial={still ? false : { opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: arm.index * 0.06 }}
            >
              <motion.line
                x1={CENTRE}
                y1={CENTRE}
                x2={arm.x}
                y2={arm.y}
                stroke={colour}
                strokeWidth={risky ? 2 : 1}
                strokeLinecap="round"
                opacity={risky ? 0.75 : 0.45}
                initial={still ? false : { pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: arm.index * 0.06, ease: [0.22, 1, 0.36, 1] }}
              />

              {/* The endpoint: a filled node for a high-risk power, hollow for a benign one. */}
              <circle
                cx={arm.x}
                cy={arm.y}
                r={risky ? 5.5 : 3.5}
                fill={risky ? colour : "var(--panel)"}
                stroke={colour}
                strokeWidth={1.5}
              />

              {risky && !still ? (
                <motion.circle
                  cx={arm.x}
                  cy={arm.y}
                  r={5.5}
                  fill="none"
                  stroke={colour}
                  animate={{ r: [5.5, 12], opacity: [0.55, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: arm.index * 0.3 }}
                />
              ) : null}
            </motion.g>
          );
        })}

        {/* The account at the centre: what all of this reaches into. */}
        <circle cx={CENTRE} cy={CENTRE} r={HUB} fill="var(--panel)" stroke="var(--line-strong)" />
        <circle cx={CENTRE} cy={CENTRE} r={HUB - 5} fill="var(--bonded)" opacity={0.85} />
      </svg>

      {/*
        Labels as an HTML layer over the diagram, rather than SVG <title> elements.
        
        React 19 treats <title> as hoistable document metadata, so a <title> inside an <svg> renders
        with its text stripped -- the elements appeared in the output completely empty while the
        geometry beside them was correct. That is a quiet failure: the diagram still looked right and
        simply told you nothing about which power was which.
        
        Doing it in HTML is better anyway. These are real focusable elements, so the capabilities are
        reachable by keyboard and announced by a screen reader, which an SVG <title> alone would not
        have given.
      */}
      <div className="pointer-events-none absolute inset-0">
        {arms.map((arm) => (
          <button
            key={`${arm.capability.target}-${arm.capability.selector}-hit`}
            type="button"
            title={`${arm.capability.label}${arm.capability.highRisk ? " \u2014 high risk" : ""}\non ${arm.capability.target}`}
            className="pointer-events-auto absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-pill focus-visible:outline-2"
            style={{ left: `${(arm.x / SIZE) * 100}%`, top: `${(arm.y / SIZE) * 100}%` }}
          >
            <span className="sr-only">
              {arm.capability.label}
              {arm.capability.highRisk ? ", high risk" : ""}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-1 text-center shout text-[0.6rem] text-faint">
        {capabilities.length} {capabilities.length === 1 ? "power" : "powers"}
        {riskyCount > 0 ? ` \u00b7 ${riskyCount} high risk` : ""}
        {movesNativeValue ? " \u00b7 native value" : ""}
      </p>
    </div>
  );
}
