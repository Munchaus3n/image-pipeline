// Build channel configuration.
//
// This is the ONE switch that separates a normal full build from a
// time-limited evaluation build. The committed default is "full", so ordinary
// builds run no evaluation code at all and can never be affected by a stamp an
// evaluation build left on a machine.
//
// To produce an evaluation build, set:
//   channel: "eval"
//   grantId: a unique id for this issuance, e.g. "eval-2026-11"
// Each new evaluation build you hand out should use a NEW grantId. Because the
// stamp is stored per-grant, a new grantId starts a fresh period and ignores
// any previous (expired) one — so a renewal never collides with an old stamp,
// and the full build ignores all of them.

module.exports = {
  channel: "full",            // "full" | "eval"
  grantId: "",                // required when channel === "eval", e.g. "eval-2026-11"
  evalDays: 365,              // length of the evaluation period
  appName: "Cutout Studio",   // runtime identity: userData folder + registry namespace
};
