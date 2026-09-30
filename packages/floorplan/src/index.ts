export { buildRoundTable, buildRow, quickLayout, rowLabel, SEAT_PITCH_CM } from './builders.ts';
export {
  CALIBRATION_METRES,
  type CalibrationProblem,
  calibrationScale,
  currentScale,
  type ImagePoint,
  initialUnderlay,
  MIN_CALIBRATION_PIXELS,
  roomToImage,
  scaleUnderlay,
} from './calibrate.ts';
export {
  FloorObject,
  FloorplanDoc,
  Item,
  MAX_ITEMS,
  MAX_SEATS,
  OBJECT_TYPES,
  PUBLIC_UNDERLAY_OPACITY,
  Row,
  Seat,
  Section,
  Table,
  UNDERLAY_OPACITY,
  Underlay,
} from './document.ts';
export {
  canonicalJson,
  type Hit,
  hitTest,
  type LayoutProblem,
  layoutProblems,
  type PlacedSeat,
  placedSeats,
  seatCount,
} from './geometry.ts';
export { itemCenter, MAP_AREAS, type MapArea, mapArea, nearestObject, seatPosition } from './guide.ts';
