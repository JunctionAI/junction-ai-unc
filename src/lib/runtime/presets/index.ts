/* Industry parameter presets — see docs/PRESETS.md.

   types.ts     the fields per domain (paid · email · content · seo · sales), ranges, validation
   industry.ts  the seven bands with provenance, pickBand / resolvePreset (pure)
   routines.ts  routine ↔ domain, the 3–6 relevant fields, optional steps, spec bindings (pure)
   store.ts     account_presets / routine_params (migration 0015), getPreset, MetaPreset getter */

export * from "./types";
export * from "./industry";
export * from "./routines";
export * from "./store";
