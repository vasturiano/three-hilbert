import { Box3, Group, Vector3 } from 'three';

export interface ThreeHilbertData<Range extends number | bigint = number> {
  start: Range;
  length: Range;
  [key: string]: unknown;
}

type SupportedData = ThreeHilbertData<number> | ThreeHilbertData<bigint>;

export type Accessor<T, Value> =
  | Value
  | string
  | ((datum: T) => Value);

declare class ThreeHilbert<T extends SupportedData = SupportedData> extends Group {
  constructor();

  order(): number;
  order(value: number): this;

  data(): T[];
  data(value: T[]): this;

  padding(): Accessor<T, number>;
  padding(value: Accessor<T, number>): this;

  paddingAbsolute(): Accessor<T, number>;
  paddingAbsolute(value: Accessor<T, number>): this;

  color(): Accessor<T, string | number> | null;
  color(value: Accessor<T, string | number> | null): this;

  label(): Accessor<T, string>;
  label(value: Accessor<T, string>): this;

  labelColor(): Accessor<T, string | number | false | null>;
  labelColor(value: Accessor<T, string | number | false | null>): this;

  simplifyCurves(): boolean;
  simplifyCurves(value: boolean): this;

  useInstancedMeshes(): boolean;
  useInstancedMeshes(value: boolean): this;

  getPositionAtVal(value: number | bigint): Vector3;
  getRangeBbox(start: number, length: number): Box3;
  getRangeBbox(start: bigint, length: bigint): Box3;
}

export default ThreeHilbert;
