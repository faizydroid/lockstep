"use client";

/**
 * Wraps page content so route changes have a direction, and adds the scroll rail.
 *
 * A separate component because the layout is a server component and both of these need the
 * pathname and browser scroll. Keeping them here means the layout stays static and only this
 * subtree is client-side.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { RouteTransition, ScrollProgress } from "./motion";

export function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <ScrollProgress />
      <RouteTransition routeKey={pathname}>{children}</RouteTransition>
    </>
  );
}
