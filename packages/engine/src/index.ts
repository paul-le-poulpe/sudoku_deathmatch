export * from "./config.ts";
export { DIR_DOWN, DIR_LEFT, DIR_MASK, DIR_RIGHT, DIR_UP, cellAt, move } from "./move.ts";
export { ballAt, ballOut, cellCenter, directionPerMille, within } from "./ball.ts";
export { activeShield, shieldCharge, spendShield, type ShieldLike } from "./shield.ts";
export {
  TRAP_CELLS,
  createGame,
  step,
  type Ball,
  type EngineEvent,
  type FillRequest,
  type Game,
  type BlockRequest,
  type HitRequest,
  type PlaceRequest,
  type Player,
  type RankEntry,
  type TickInput,
  type Trap,
  type TrapKind,
} from "./game.ts";
