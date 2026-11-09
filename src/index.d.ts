import { Box3, Camera, Group, Vector3 } from 'three';

export interface ThreeHilbertData {
  start: number | bigint;
  length: number | bigint;
}

export type Accessor<T, Value> =
  | Value
  | string
  | ((datum: T) => Value);

declare class ThreeHilbert<T extends ThreeHilbertData = ThreeHilbertData> extends Group {
  constructor();

  order(): number;
  order(value: number): this;

  data(): T[];
  data(value: T[]): this;

  padding(): Accessor<T, number>;
  padding(value: Accessor<T, number>): this;

  color(): Accessor<T, string | number> | null;
  color(value: Accessor<T, string | number> | null): this;

  label(): Accessor<T, string>;
  label(value: Accessor<T, string>): this;

  labelColor(): Accessor<T, string | number>;
  labelColor(value: Accessor<T, string | number>): this;

  simplifyCurves(): boolean;
  simplifyCurves(value: boolean): this;

  useInstancedMeshes(): boolean;
  useInstancedMeshes(value: boolean): this;

  setPointOfView(camera: Camera): number;

  getPositionAtVal(value: number | bigint): Vector3;
  getRangeBbox(start: number | bigint, length: number | bigint): Box3;
}

export default ThreeHilbert;
