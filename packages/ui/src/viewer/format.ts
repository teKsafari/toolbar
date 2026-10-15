// Formatting helpers for the capture page: clock times, sizes, durations, console values. They
// live in @toolbar/shared/derive, which builds the console rows' messages; the viewer kept its
// own copy before, and the copy printed tagged values (a Date) in their wire form while the
// collapsed message showed the ISO string (J-055, J-056).
export {
  fmtArgs,
  fmtBytes,
  fmtClock,
  fmtClockPrecise,
  fmtDuration,
  fmtTimestamp,
  fmtValue,
  fmtWallMs,
  hostOf,
  prettyBody,
  secondsParam,
  type ZoneChoice,
} from '@toolbar/shared/derive';
