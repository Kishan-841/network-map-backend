/**
 * Values shared by the fiber and closure schemas.
 *
 * They live here rather than in either module because the two import from each
 * other — closures need the fiber types, fibers need the splitter ratios — and
 * a cycle leaves whichever loads second holding `undefined`.
 */
export const CORE_COUNTS = [2, 4, 6, 12, 24, 48]

/**
 * What kind of cable a route is, in the field's words: the main span, a branch
 * off it, or the drop that reaches a building.
 */
export const FIBER_TYPES = ['MAIN_SF', 'SUB_SF', 'DROP_CABLE']

/** Core counts a closure's In / Out cable may have — the fibre list plus 8. */
export const CLOSURE_CABLE_CORES = [2, 4, 6, 8, 12, 24, 48]

/** Which side of a closure a cable is on. */
export const CABLE_DIRECTIONS = ['IN', 'OUT']

/** Where in a building a splitter is fitted (Splitters page, 24 Nov 2026). A floor number goes only with FLOOR. */
export const SPLITTER_PLACEMENTS = ['TERRACE', 'FLOOR', 'GROUND', 'BASEMENT']
export const MAX_FLOOR = 200
